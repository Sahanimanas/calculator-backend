// routes/mro-allocation.routes.js - MRO Allocation Routes (Updated with Collection Mapping)

const express = require('express');
const router = express.Router();
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const { Parser } = require('json2csv');
const mongoose = require('mongoose');

// Models
const MROAllocationSummary = require('../models/MROAllocationSummary');
const MROAllocationUploadMeta = require('../models/MROAllocationUploadMeta');
const Geography = require('../models/Geography');
const Client = require('../models/Client');
const Project = require('../models/Project');
const Subproject = require('../models/Subproject');

const upload = multer({ dest: 'uploads/' });

const norm = (s) => (typeof s === 'string' ? s.trim() : '');

// MRO Pricing Constants
const MRO_PRICING = {
  PROCESSING: {
    'NRS-NO Records': 2.25,
    'Manual': 3.00
  },
  LOGGING: 1.08
};

const VALID_PROCESS_TYPES = ['Processing', 'Logging'];
const VALID_REQUESTOR_TYPES = ['Manual', 'NRS-NO Records'];
const VALID_REQUEST_TYPES = ['New Request', 'Follow up'];

// =============================================
// HELPER: Build lookup caches from database
// =============================================
async function buildLookupCaches() {
  console.log('📦 Building lookup caches from database...');

  // Get all geographies
  const geographies = await Geography.find({ status: 'active' }).lean();
  const geographyMap = new Map();
  geographies.forEach(g => {
    geographyMap.set(g.name.toLowerCase(), g);
  });
  console.log(`   ✓ Loaded ${geographies.length} geographies`);

  // Get MRO client(s) - find clients named "MRO"
  const mroClients = await Client.find({ 
    name: { $regex: /^MRO$/i },
    status: 'active'
  }).lean();
  
  const clientMap = new Map();
  mroClients.forEach(c => {
    // Key by geography_id
    clientMap.set(c.geography_id.toString(), c);
  });
  console.log(`   ✓ Loaded ${mroClients.length} MRO client(s)`);

  // Get all projects under MRO clients
  const mroClientIds = mroClients.map(c => c._id);
  const projects = await Project.find({ 
    client_id: { $in: mroClientIds },
    status: 'active'
  }).lean();
  
  // Map: client_id + project_name (lowercase) -> project
  const projectMap = new Map();
  projects.forEach(p => {
    const key = `${p.client_id.toString()}_${p.name.toLowerCase()}`;
    projectMap.set(key, p);
  });
  console.log(`   ✓ Loaded ${projects.length} projects (Processing/Logging)`);

  // Get all subprojects under those projects
  const projectIds = projects.map(p => p._id);
  const subprojects = await Subproject.find({ 
    project_id: { $in: projectIds },
    status: 'active'
  }).lean();
  
  // Map: project_id + subproject_name (lowercase) -> subproject
  const subprojectMap = new Map();
  subprojects.forEach(s => {
    const key = `${s.project_id.toString()}_${s.name.toLowerCase()}`;
    subprojectMap.set(key, s);
  });
  console.log(`   ✓ Loaded ${subprojects.length} subprojects (Locations)`);

  return {
    geographyMap,
    clientMap,
    projectMap,
    subprojectMap,
    mroClients
  };
}

// =============================================
// UPLOAD MRO ALLOCATION DATA
// =============================================
router.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const filePath = req.file.path;
  const startTime = Date.now();

  try {
    console.log('⏱️  MRO Upload started...');

    // STEP 1: Build lookup caches
    const { geographyMap, clientMap, projectMap, subprojectMap, mroClients } = await buildLookupCaches();

    if (mroClients.length === 0) {
      fs.unlinkSync(filePath);
      return res.status(400).json({ 
        error: 'MRO client not found in database. Please create the MRO client under Geography first.',
        hint: 'Go to Admin > Clients and create a client named "MRO" under the appropriate geography (US/IND)'
      });
    }

    // STEP 2: Read and validate CSV
    const validRows = [];
    const errors = [];
    let minDate = null;
    let maxDate = null;
    let rowCount = 0;
    let processingCount = 0;
    let loggingCount = 0;

    await new Promise((resolve, reject) => {
      fs.createReadStream(filePath)
        .pipe(
          csv({
            mapHeaders: ({ header }) => {
              const cleanHeader = header.toLowerCase().trim();
              if (cleanHeader.includes('sr') && cleanHeader.includes('no')) return 'sr_no';
              if (cleanHeader.includes('assigner') || (cleanHeader.includes('name') && !cleanHeader.includes('location'))) return 'assigner_name';
              if (cleanHeader.includes('location')) return 'location';
              if (cleanHeader.includes('request') && cleanHeader.includes('id')) return 'request_id';
              if (cleanHeader.includes('request') && cleanHeader.includes('type') && !cleanHeader.includes('requestor')) return 'request_type';
              if (cleanHeader.includes('requestor') && cleanHeader.includes('type')) return 'requestor_type';
              if (cleanHeader.includes('logging') || (cleanHeader.includes('processing') && !cleanHeader.includes('location'))) return 'process_type';
              if (cleanHeader.includes('geography') || cleanHeader.includes('region')) return 'geography';
              if (cleanHeader.includes('date')) return 'allocation_date';
              return header;
            },
          })
        )
        .on('data', (r) => {
          rowCount++;
          
          if (rowCount % 10000 === 0) {
            console.log(`  📊 Reading row ${rowCount}...`);
          }

          // Skip completely empty rows
          if (Object.values(r).every((v) => !v)) return;

          const assigner_name = norm(r.assigner_name);
          const location = norm(r.location);
          const request_id = norm(r.request_id);
          const request_type = norm(r.request_type);
          const requestor_type = norm(r.requestor_type);
          const process_type = norm(r.process_type);
          const geography = norm(r.geography) || 'US';
          const allocation_date = norm(r.allocation_date);

          const rowOut = {
            __row: rowCount,
            assigner_name,
            location,
            request_id,
            request_type,
            requestor_type,
            process_type,
            geography,
            allocation_date
          };

          const rowErrors = [];

          // ============================================
          // VALIDATION
          // ============================================

          // Required fields
          if (!assigner_name) rowErrors.push('Assigner Name required');
          if (!location) rowErrors.push('Location required');
          if (!process_type) rowErrors.push('Logging/Processing required');

          // Validate process type
          const matchedProcessType = VALID_PROCESS_TYPES.find(
            (t) => t.toLowerCase() === process_type.toLowerCase()
          );
          if (!matchedProcessType && process_type) {
            rowErrors.push(`Invalid Process Type "${process_type}". Allowed: ${VALID_PROCESS_TYPES.join(', ')}`);
          } else if (matchedProcessType) {
            rowOut.process_type = matchedProcessType;
            if (matchedProcessType === 'Processing') {
              processingCount++;
            } else {
              loggingCount++;
            }
          }

          // Validate requestor type for Processing
          if (rowOut.process_type === 'Processing') {
            if (!requestor_type) {
              rowErrors.push('Requestor Type required for Processing');
            } else {
              const matchedRequestorType = VALID_REQUESTOR_TYPES.find(
                (t) => t.toLowerCase() === requestor_type.toLowerCase()
              );
              if (!matchedRequestorType) {
                rowErrors.push(`Invalid Requestor Type "${requestor_type}". Allowed: ${VALID_REQUESTOR_TYPES.join(', ')}`);
              } else {
                rowOut.requestor_type = matchedRequestorType;
              }
            }
          }

          // Validate request type if provided
          if (request_type) {
            const matchedRequestType = VALID_REQUEST_TYPES.find(
              (t) => t.toLowerCase() === request_type.toLowerCase()
            );
            if (matchedRequestType) {
              rowOut.request_type = matchedRequestType;
            }
          } else {
            rowOut.request_type = 'New Request';
          }

          // ============================================
          // MAP TO COLLECTIONS
          // ============================================

          // 1. Geography lookup
          const geoLower = geography.toLowerCase();
          const foundGeo = geographyMap.get(geoLower);
          if (!foundGeo) {
            rowErrors.push(`Geography "${geography}" not found in database`);
          } else {
            rowOut.geography_id = foundGeo._id;
            rowOut.geography_name = foundGeo.name;
          }

          // 2. Client lookup (MRO under this geography)
          if (foundGeo) {
            const foundClient = clientMap.get(foundGeo._id.toString());
            if (!foundClient) {
              rowErrors.push(`MRO client not found under geography "${geography}"`);
            } else {
              rowOut.client_id = foundClient._id;
              rowOut.client_name = foundClient.name;

              // 3. Project lookup (Processing/Logging under MRO)
              if (rowOut.process_type) {
                const projectKey = `${foundClient._id.toString()}_${rowOut.process_type.toLowerCase()}`;
                const foundProject = projectMap.get(projectKey);
                if (!foundProject) {
                  rowErrors.push(`Project "${rowOut.process_type}" not found under MRO client. Please create it first.`);
                } else {
                  rowOut.project_id = foundProject._id;
                  rowOut.project_name = foundProject.name;

                  // 4. Subproject lookup (Location under Processing/Logging)
                  const subprojectKey = `${foundProject._id.toString()}_${location.toLowerCase()}`;
                  const foundSubproject = subprojectMap.get(subprojectKey);
                  if (!foundSubproject) {
                    rowErrors.push(`Location "${location}" not found under project "${rowOut.process_type}". Please create it as a subproject first.`);
                  } else {
                    rowOut.subproject_id = foundSubproject._id;
                    rowOut.subproject_name = foundSubproject.name;
                  }
                }
              }
            }
          }

          // Parse date
          let parsedDate = new Date();
          if (allocation_date) {
            const dateFormats = [
              allocation_date,
              allocation_date.split('/').reverse().join('-'),
            ];
            for (const fmt of dateFormats) {
              const d = new Date(fmt);
              if (!isNaN(d.getTime())) {
                parsedDate = d;
                break;
              }
            }
          }
          
          rowOut.parsed_date = parsedDate;
          rowOut.day = parsedDate.getDate();
          rowOut.month = parsedDate.getMonth() + 1;
          rowOut.year = parsedDate.getFullYear();

          if (!minDate || parsedDate < minDate) minDate = parsedDate;
          if (!maxDate || parsedDate > maxDate) maxDate = parsedDate;

          if (rowErrors.length > 0) {
            errors.push({ ...rowOut, errors: rowErrors.join('; ') });
          } else {
            validRows.push(rowOut);
          }
        })
        .on('end', resolve)
        .on('error', reject);
    });

    const readTime = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`✅ Read ${rowCount} rows in ${readTime}s`);
    console.log(`📊 Valid: ${validRows.length}, Errors: ${errors.length}, Processing: ${processingCount}, Logging: ${loggingCount}`);

    if (errors.length > 0) {
      console.log(`❌ Found ${errors.length} validation errors`);
      return sendErrorCsv(res, filePath, errors);
    }

    if (validRows.length === 0) {
      fs.unlinkSync(filePath);
      return res.status(400).json({ error: 'CSV contains no valid data rows' });
    }

    // Use current date range if no dates found
    if (!minDate) minDate = new Date();
    if (!maxDate) maxDate = new Date();

    // STEP 3: Delete existing data for the date range
    console.log('🗑️  Deleting existing data...');
    const deleteStart = Date.now();
    
    const deleteResult = await MROAllocationSummary.deleteMany({
      allocation_date: {
        $gte: new Date(minDate.setHours(0, 0, 0, 0)),
        $lte: new Date(maxDate.setHours(23, 59, 59, 999))
      }
    });
    
    const deleteTime = ((Date.now() - deleteStart) / 1000).toFixed(2);
    console.log(`✅ Deleted ${deleteResult.deletedCount} records in ${deleteTime}s`);

    // STEP 4: Insert new data
    console.log('💾 Inserting data...');
    const insertStart = Date.now();

    const recordsToInsert = validRows.map(row => ({
      geography_id: row.geography_id,
      client_id: row.client_id,
      project_id: row.project_id,
      subproject_id: row.subproject_id,
      geography_name: row.geography_name,
      client_name: row.client_name,
      project_name: row.project_name,
      subproject_name: row.subproject_name,
      process_type: row.process_type,
      requestor_type: row.process_type === 'Processing' ? row.requestor_type : null,
      request_type: row.request_type,
      allocation_date: row.parsed_date,
      day: row.day,
      month: row.month,
      year: row.year,
      count: 1,
      resource_name: row.assigner_name,
      request_id: row.request_id || null
    }));

    const BATCH_SIZE = 5000;
    let totalInserted = 0;

    for (let i = 0; i < recordsToInsert.length; i += BATCH_SIZE) {
      const batch = recordsToInsert.slice(i, i + BATCH_SIZE);
      await MROAllocationSummary.insertMany(batch, { ordered: false });
      totalInserted += batch.length;
      
      if (recordsToInsert.length > 10000) {
        console.log(`  💾 Inserted ${totalInserted}/${recordsToInsert.length}...`);
      }
    }

    const insertTime = ((Date.now() - insertStart) / 1000).toFixed(2);
    console.log(`✅ Inserted ${totalInserted} records in ${insertTime}s`);

    // STEP 5: Save metadata
    const uniqueMonths = [...new Set(validRows.map(d => d.month))];
    const uniqueYears = [...new Set(validRows.map(d => d.year))];

    await MROAllocationUploadMeta.create({
      start_date: minDate,
      end_date: maxDate,
      total_records: validRows.length,
      processing_records: processingCount,
      logging_records: loggingCount,
      months: uniqueMonths.sort((a, b) => a - b),
      years: uniqueYears.sort((a, b) => a - b),
      filename: req.file.originalname
    });

    fs.unlinkSync(filePath);

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n🎉 MRO Upload completed in ${totalTime}s!`);

    return res.json({
      status: 'success',
      message: 'MRO allocation data uploaded successfully',
      summary: {
        totalRecords: validRows.length,
        processingRecords: processingCount,
        loggingRecords: loggingCount,
        inserted: totalInserted,
        dateRange: {
          start: minDate.toISOString().split('T')[0],
          end: maxDate.toISOString().split('T')[0]
        },
        months: uniqueMonths.sort((a, b) => a - b),
        years: uniqueYears.sort((a, b) => a - b),
        processingTime: `${totalTime}s`
      }
    });

  } catch (err) {
    console.error('❌ MRO Upload error:', err);
    console.error(err.stack);
    try { fs.unlinkSync(filePath); } catch {}
    return res.status(500).json({ error: err.message });
  }
});

// =============================================
// GET PROCESSING SUMMARY (Location-based with NRS-NO Records & Manual breakdown)
// =============================================
router.get('/processing-summary', async (req, res) => {
  try {
    const { 
      year, 
      month, 
      start_date,
      end_date,
      geography_id,
      client_id,
      project_id,
      search,
      page = 1,
      limit = 50
    } = req.query;

    const query = {
      process_type: 'Processing'
    };

    if (year) query.year = parseInt(year);
    if (month && month !== 'all') query.month = parseInt(month);
    
    if (start_date || end_date) {
      query.allocation_date = {};
      if (start_date) query.allocation_date.$gte = new Date(start_date);
      if (end_date) {
        const endDateObj = new Date(end_date);
        endDateObj.setHours(23, 59, 59, 999);
        query.allocation_date.$lte = endDateObj;
      }
    }

    // Filter by hierarchy if provided
    if (geography_id && mongoose.Types.ObjectId.isValid(geography_id)) {
      query.geography_id = new mongoose.Types.ObjectId(geography_id);
    }
    if (client_id && mongoose.Types.ObjectId.isValid(client_id)) {
      query.client_id = new mongoose.Types.ObjectId(client_id);
    }
    if (project_id && mongoose.Types.ObjectId.isValid(project_id)) {
      query.project_id = new mongoose.Types.ObjectId(project_id);
    }

    if (search) {
      query.subproject_name = { $regex: search, $options: 'i' };
    }

    console.log('🔍 Processing Query:', JSON.stringify(query, null, 2));

    // Aggregation pipeline for Processing data grouped by subproject (location)
    const pipeline = [
      { $match: query },
      {
        $group: {
          _id: '$subproject_id',
          subproject_id: { $first: '$subproject_id' },
          subproject_name: { $first: '$subproject_name' },
          geography_id: { $first: '$geography_id' },
          geography_name: { $first: '$geography_name' },
          client_id: { $first: '$client_id' },
          client_name: { $first: '$client_name' },
          project_id: { $first: '$project_id' },
          project_name: { $first: '$project_name' },
          nrsNoRecords: {
            $sum: {
              $cond: [{ $eq: ['$requestor_type', 'NRS-NO Records'] }, '$count', 0]
            }
          },
          manual: {
            $sum: {
              $cond: [{ $eq: ['$requestor_type', 'Manual'] }, '$count', 0]
            }
          }
        }
      },
      {
        $project: {
          _id: 0,
          subproject_id: 1,
          location: '$subproject_name',
          geography_id: 1,
          geography_name: 1,
          client_id: 1,
          client_name: 1,
          project_id: 1,
          project_name: 1,
          nrsNoRecords: 1,
          manual: 1,
          nrsNoTotal: { $multiply: ['$nrsNoRecords', MRO_PRICING.PROCESSING['NRS-NO Records']] },
          manualTotal: { $multiply: ['$manual', MRO_PRICING.PROCESSING['Manual']] },
          totalBilling: {
            $add: [
              { $multiply: ['$nrsNoRecords', MRO_PRICING.PROCESSING['NRS-NO Records']] },
              { $multiply: ['$manual', MRO_PRICING.PROCESSING['Manual']] }
            ]
          },
          grandTotal: { $add: ['$nrsNoRecords', '$manual'] }
        }
      },
      { $sort: { location: 1 } }
    ];

    // Get total count of locations
    const countPipeline = [
      { $match: query },
      { $group: { _id: '$subproject_id' } },
      { $count: 'total' }
    ];
    const countResult = await MROAllocationSummary.aggregate(countPipeline);
    const totalItems = countResult[0]?.total || 0;

    // Add pagination
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    pipeline.push({ $skip: skip });
    pipeline.push({ $limit: limitNum });

    const data = await MROAllocationSummary.aggregate(pipeline);

    // Calculate grand totals (all data, not just current page)
    const grandTotalPipeline = [
      { $match: query },
      {
        $group: {
          _id: null,
          nrsNoRecords: {
            $sum: {
              $cond: [{ $eq: ['$requestor_type', 'NRS-NO Records'] }, '$count', 0]
            }
          },
          manual: {
            $sum: {
              $cond: [{ $eq: ['$requestor_type', 'Manual'] }, '$count', 0]
            }
          }
        }
      }
    ];

    const grandTotalResult = await MROAllocationSummary.aggregate(grandTotalPipeline);
    const totals = grandTotalResult[0] || { nrsNoRecords: 0, manual: 0 };
    
    totals.nrsNoTotal = totals.nrsNoRecords * MRO_PRICING.PROCESSING['NRS-NO Records'];
    totals.manualTotal = totals.manual * MRO_PRICING.PROCESSING['Manual'];
    totals.totalBilling = totals.nrsNoTotal + totals.manualTotal;
    totals.grandTotal = totals.nrsNoRecords + totals.manual;

    const totalPages = Math.ceil(totalItems / limitNum);

    res.json({
      data,
      totals,
      pricing: MRO_PRICING.PROCESSING,
      pagination: {
        currentPage: pageNum,
        totalPages,
        totalItems,
        itemsPerPage: limitNum,
        hasNextPage: pageNum < totalPages,
        hasPrevPage: pageNum > 1
      }
    });

  } catch (error) {
    console.error('❌ Error fetching processing summary:', error);
    res.status(500).json({ error: error.message });
  }
});

// =============================================
// GET LOGGING SUMMARY (Simple total with flat rate)
// =============================================
router.get('/logging-summary', async (req, res) => {
  try {
    const { 
      year, 
      month, 
      start_date,
      end_date,
      geography_id,
      client_id,
      project_id
    } = req.query;

    const query = {
      process_type: 'Logging'
    };

    if (year) query.year = parseInt(year);
    if (month && month !== 'all') query.month = parseInt(month);
    
    if (start_date || end_date) {
      query.allocation_date = {};
      if (start_date) query.allocation_date.$gte = new Date(start_date);
      if (end_date) {
        const endDateObj = new Date(end_date);
        endDateObj.setHours(23, 59, 59, 999);
        query.allocation_date.$lte = endDateObj;
      }
    }

    // Filter by hierarchy if provided
    if (geography_id && mongoose.Types.ObjectId.isValid(geography_id)) {
      query.geography_id = new mongoose.Types.ObjectId(geography_id);
    }
    if (client_id && mongoose.Types.ObjectId.isValid(client_id)) {
      query.client_id = new mongoose.Types.ObjectId(client_id);
    }
    if (project_id && mongoose.Types.ObjectId.isValid(project_id)) {
      query.project_id = new mongoose.Types.ObjectId(project_id);
    }

    console.log('🔍 Logging Query:', JSON.stringify(query, null, 2));

    // Get total count of logging records
    const totalPipeline = [
      { $match: query },
      {
        $group: {
          _id: null,
          totalCases: { $sum: '$count' }
        }
      }
    ];

    const result = await MROAllocationSummary.aggregate(totalPipeline);
    const totalCases = result[0]?.totalCases || 0;
    const totalBilling = totalCases * MRO_PRICING.LOGGING;

    res.json({
      data: [{
        details: 'MRO Logging',
        totalCases,
        pricing: MRO_PRICING.LOGGING,
        totalBilling
      }],
      totals: {
        totalCases,
        pricing: MRO_PRICING.LOGGING,
        totalBilling
      }
    });

  } catch (error) {
    console.error('❌ Error fetching logging summary:', error);
    res.status(500).json({ error: error.message });
  }
});

// =============================================
// GET LATEST UPLOAD INFO
// =============================================
router.get('/latest-upload', async (req, res) => {
  try {
    const latestUpload = await MROAllocationUploadMeta.findOne()
      .sort({ upload_date: -1 })
      .lean();

    if (!latestUpload) {
      return res.json({ message: 'No upload history found', upload: null });
    }

    res.json({ upload: latestUpload });

  } catch (error) {
    console.error('Error fetching latest upload:', error);
    res.status(500).json({ error: error.message });
  }
});

// =============================================
// GET UPLOAD HISTORY
// =============================================
router.get('/upload-history', async (req, res) => {
  try {
    const { limit = 10 } = req.query;

    const history = await MROAllocationUploadMeta.find()
      .sort({ upload_date: -1 })
      .limit(parseInt(limit))
      .lean();

    res.json({ history });

  } catch (error) {
    console.error('Error fetching upload history:', error);
    res.status(500).json({ error: error.message });
  }
});

// =============================================
// GET OVERALL MRO SUMMARY (Processing + Logging combined)
// =============================================
router.get('/overall-summary', async (req, res) => {
  try {
    const { year, month, start_date, end_date, geography_id } = req.query;

    const baseQuery = {};
    if (year) baseQuery.year = parseInt(year);
    if (month && month !== 'all') baseQuery.month = parseInt(month);
    
    if (start_date || end_date) {
      baseQuery.allocation_date = {};
      if (start_date) baseQuery.allocation_date.$gte = new Date(start_date);
      if (end_date) {
        const endDateObj = new Date(end_date);
        endDateObj.setHours(23, 59, 59, 999);
        baseQuery.allocation_date.$lte = endDateObj;
      }
    }

    if (geography_id && mongoose.Types.ObjectId.isValid(geography_id)) {
      baseQuery.geography_id = new mongoose.Types.ObjectId(geography_id);
    }

    // Processing summary
    const processingQuery = { ...baseQuery, process_type: 'Processing' };
    const processingResult = await MROAllocationSummary.aggregate([
      { $match: processingQuery },
      {
        $group: {
          _id: null,
          nrsNoRecords: {
            $sum: { $cond: [{ $eq: ['$requestor_type', 'NRS-NO Records'] }, '$count', 0] }
          },
          manual: {
            $sum: { $cond: [{ $eq: ['$requestor_type', 'Manual'] }, '$count', 0] }
          }
        }
      }
    ]);

    const processing = processingResult[0] || { nrsNoRecords: 0, manual: 0 };
    processing.nrsNoTotal = processing.nrsNoRecords * MRO_PRICING.PROCESSING['NRS-NO Records'];
    processing.manualTotal = processing.manual * MRO_PRICING.PROCESSING['Manual'];
    processing.totalBilling = processing.nrsNoTotal + processing.manualTotal;
    processing.grandTotal = processing.nrsNoRecords + processing.manual;

    // Logging summary
    const loggingQuery = { ...baseQuery, process_type: 'Logging' };
    const loggingResult = await MROAllocationSummary.aggregate([
      { $match: loggingQuery },
      { $group: { _id: null, totalCases: { $sum: '$count' } } }
    ]);

    const logging = {
      totalCases: loggingResult[0]?.totalCases || 0,
      pricing: MRO_PRICING.LOGGING,
      totalBilling: (loggingResult[0]?.totalCases || 0) * MRO_PRICING.LOGGING
    };

    // Combined total
    const grandTotal = {
      totalCases: processing.grandTotal + logging.totalCases,
      totalBilling: processing.totalBilling + logging.totalBilling
    };

    res.json({
      processing,
      logging,
      grandTotal,
      pricing: MRO_PRICING
    });

  } catch (error) {
    console.error('Error fetching overall summary:', error);
    res.status(500).json({ error: error.message });
  }
});

// =============================================
// GET AVAILABLE LOCATIONS (Subprojects under MRO)
// =============================================
router.get('/locations', async (req, res) => {
  try {
    const { process_type, geography_id, search } = req.query;

    // Find MRO clients
    const clientQuery = { name: { $regex: /^MRO$/i }, status: 'active' };
    if (geography_id && mongoose.Types.ObjectId.isValid(geography_id)) {
      clientQuery.geography_id = new mongoose.Types.ObjectId(geography_id);
    }
    const mroClients = await Client.find(clientQuery).lean();
    const clientIds = mroClients.map(c => c._id);

    // Find projects (Processing/Logging)
    const projectQuery = { client_id: { $in: clientIds }, status: 'active' };
    if (process_type) {
      projectQuery.name = { $regex: new RegExp(`^${process_type}$`, 'i') };
    }
    const projects = await Project.find(projectQuery).lean();
    const projectIds = projects.map(p => p._id);

    // Find subprojects (Locations)
    const subprojectQuery = { project_id: { $in: projectIds }, status: 'active' };
    if (search) {
      subprojectQuery.name = { $regex: search, $options: 'i' };
    }
    const subprojects = await Subproject.find(subprojectQuery)
      .select('_id name project_id project_name geography_id geography_name')
      .sort({ name: 1 })
      .lean();

    res.json({ locations: subprojects });

  } catch (error) {
    console.error('Error fetching locations:', error);
    res.status(500).json({ error: error.message });
  }
});

// =============================================
// DELETE MRO DATA
// =============================================
router.delete('/data', async (req, res) => {
  try {
    const { year, month, process_type, start_date, end_date } = req.query;

    const query = {};
    if (year) query.year = parseInt(year);
    if (month) query.month = parseInt(month);
    if (process_type) query.process_type = process_type;
    
    if (start_date || end_date) {
      query.allocation_date = {};
      if (start_date) query.allocation_date.$gte = new Date(start_date);
      if (end_date) query.allocation_date.$lte = new Date(end_date);
    }

    const result = await MROAllocationSummary.deleteMany(query);

    res.json({
      message: 'MRO data deleted successfully',
      deletedCount: result.deletedCount
    });

  } catch (error) {
    console.error('Error deleting MRO data:', error);
    res.status(500).json({ error: error.message });
  }
});

// =============================================
// HELPER: Send Error CSV
// =============================================
function sendErrorCsv(res, filePath, errors) {
  try {
    const fields = [
      '__row',
      'assigner_name',
      'location',
      'request_id',
      'request_type',
      'requestor_type',
      'process_type',
      'geography',
      'errors'
    ];
    const parser = new Parser({ fields });
    const csvOut = parser.parse(errors);

    fs.unlinkSync(filePath);
    res.setHeader('Content-Disposition', 'attachment; filename=mro-upload-errors.csv');
    res.setHeader('Content-Type', 'text/csv');
    return res.status(400).send(csvOut);
  } catch (err) {
    console.error('Error generating error CSV:', err);
    fs.unlinkSync(filePath);
    return res.status(500).json({ error: 'Error generating error report' });
  }
}

module.exports = router;