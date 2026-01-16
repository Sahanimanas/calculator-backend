// routes/allocation-upload.routes.js - COMPLETE FIXED VERSION

const express = require('express');
const router = express.Router();
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const { Parser } = require('json2csv');

const Geography = require('../models/Geography');
const Client = require('../models/Client');
const Project = require('../models/Project');
const Subproject = require('../models/Subproject');
const SubprojectRequestType = require('../models/SubprojectRequestType');
const AllocationSummary = require('../models/AllocationSummary');
const AllocationUploadMeta = require('../models/AllocationUploadMeta');

const upload = multer({ dest: 'uploads/' });

const norm = (s) => (typeof s === 'string' ? s.trim() : '');

// Normalize for matching - removes spaces, underscores, hyphens
const normalizeKey = (str) => str.toLowerCase().replace(/[\s_-]+/g, '');

const GEOGRAPHY_TYPE_MAPPING = {
  'US': 'onshore',
  'USA': 'onshore',
  'UNITED STATES': 'onshore',
  'ONSHORE': 'onshore',
  'IND': 'offshore',
  'INDIA': 'offshore',
  'OFFSHORE': 'offshore'
};

const ALL_REQUEST_TYPES = ['New Request', 'Key', 'Duplicate'];

// =============================================
// OPTIMIZED ALLOCATION UPLOAD
// =============================================
router.post('/upload-allocations', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const filePath = req.file.path;
  const startTime = Date.now();

  try {
    console.log('⏱️  Upload started...');

    // STEP 1: Read and validate CSV in streaming mode
    const validRows = [];
    const errors = [];
    let minDate = null;
    let maxDate = null;
    let rowCount = 0;

    await new Promise((resolve, reject) => {
      fs.createReadStream(filePath)
        .pipe(
          csv({
            mapHeaders: ({ header }) => {
              const cleanHeader = header.toLowerCase().trim();
              if (cleanHeader.includes('allocation date') || cleanHeader.includes('date')) return 'allocation_date';
              if (cleanHeader.includes('name') || cleanHeader.includes('resource')) return 'resource_name';
              if (cleanHeader.includes('request type')) return 'request_type';
              if (cleanHeader.includes('location')) return 'location';
              if (cleanHeader.includes('process type') || cleanHeader.includes('project')) return 'process_type';
              if (cleanHeader.includes('geography') || cleanHeader.includes('region')) return 'geography';
              return header;
            },
          })
        )
        .on('data', (r) => {
          rowCount++;
          
          if (rowCount % 10000 === 0) {
            console.log(`  📊 Reading row ${rowCount}...`);
          }

          if (Object.values(r).every((v) => !v)) return;

          const allocation_date = norm(r.allocation_date);
          const resource_name = norm(r.resource_name);
          const request_type = norm(r.request_type);
          const location = norm(r.location);
          const process_type = norm(r.process_type);
          const geography = norm(r.geography);

          const rowOut = {
            __row: rowCount,
            allocation_date,
            resource_name,
            request_type,
            location,
            process_type,
            geography,
          };

          const rowErrors = [];

          if (!allocation_date) rowErrors.push('Allocation Date required');
          if (!resource_name) rowErrors.push('Resource Name required');
          if (!request_type) rowErrors.push('Request Type required');
          if (!location) rowErrors.push('Location required');
          if (!process_type) rowErrors.push('Process Type required');
          if (!geography) rowErrors.push('Geography required');

          const matchedType = ALL_REQUEST_TYPES.find(
            (t) => t.toLowerCase() === request_type.toLowerCase()
          );
          if (!matchedType && request_type) {
            rowErrors.push(`Invalid Request Type. Allowed: ${ALL_REQUEST_TYPES.join(', ')}`);
          } else if (matchedType) {
            rowOut.request_type = matchedType;
          }

          let parsedDate = null;
          if (allocation_date) {
            parsedDate = new Date(allocation_date);
            if (isNaN(parsedDate.getTime())) {
              rowErrors.push('Invalid date format. Use MM/DD/YYYY or YYYY-MM-DD');
            } else {
              rowOut.parsed_date = parsedDate;
              rowOut.day = parsedDate.getDate();
              rowOut.month = parsedDate.getMonth() + 1;
              rowOut.year = parsedDate.getFullYear();

              if (!minDate || parsedDate < minDate) minDate = parsedDate;
              if (!maxDate || parsedDate > maxDate) maxDate = parsedDate;
            }
          }

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

    if (errors.length > 0) {
      console.log(`❌ Found ${errors.length} validation errors`);
      return sendErrorCsv(res, filePath, errors);
    }

    if (validRows.length === 0) {
      fs.unlinkSync(filePath);
      return res.status(400).json({ error: 'CSV contains no valid data rows' });
    }

    // STEP 2: Load ALL entities from database ONCE
    console.log('🔍 Loading entities from database...');
    const dbLoadStart = Date.now();
    
    const [allGeographies, allClients, allProjects, allSubprojects] = await Promise.all([
      Geography.find({ status: 'active' }).lean(),
      Client.find({ status: 'active' }).lean(),
      Project.find({ status: 'active' }).lean(),
      Subproject.find({ status: 'active' }).lean()
    ]);

    const dbLoadTime = ((Date.now() - dbLoadStart) / 1000).toFixed(2);
    console.log(`📊 Loaded ${allGeographies.length} geographies, ${allClients.length} clients, ${allProjects.length} projects, ${allSubprojects.length} locations in ${dbLoadTime}s`);

    // STEP 3: Build optimized lookup maps
    console.log('🗺️  Building lookup maps...');
    const mapStart = Date.now();

    // Geography map
    const geoMap = new Map();
    allGeographies.forEach(g => {
      const key1 = g.name.toLowerCase().trim();
      const key2 = normalizeKey(g.name);
      geoMap.set(key1, g);
      geoMap.set(key2, g);
    });

    // Client map - by geography
    const clientsByGeo = new Map();
    allClients.forEach(c => {
      const geoId = c.geography_id.toString();
      if (!clientsByGeo.has(geoId)) {
        clientsByGeo.set(geoId, []);
      }
      clientsByGeo.get(geoId).push(c);
    });

    // Project map - by client
    const projectsByClient = new Map();
    allProjects.forEach(p => {
      const clientId = p.client_id.toString();
      if (!projectsByClient.has(clientId)) {
        projectsByClient.set(clientId, []);
      }
      projectsByClient.get(clientId).push(p);
    });

    // Subproject map - by project
    const subprojectsByProject = new Map();
    allSubprojects.forEach(s => {
      const projectId = s.project_id.toString();
      if (!subprojectsByProject.has(projectId)) {
        subprojectsByProject.set(projectId, []);
      }
      subprojectsByProject.get(projectId).push(s);
    });

    const mapTime = ((Date.now() - mapStart) / 1000).toFixed(2);
    console.log(`✅ Built maps in ${mapTime}s`);

    // STEP 4: Process rows - NO DB QUERIES
    console.log('📊 Processing allocations...');
    const processStart = Date.now();
    
    const allocationMap = new Map();
    const skippedRows = [];
    let processedCount = 0;

    for (const row of validRows) {
      processedCount++;
      
      if (processedCount % 10000 === 0) {
        console.log(`  ⚙️  Processing row ${processedCount}/${validRows.length}...`);
      }

      // Find geography
      const geography = geoMap.get(row.geography.toLowerCase().trim()) || 
                       geoMap.get(normalizeKey(row.geography));
      
      if (!geography) {
        skippedRows.push({
          ...row,
          error: `Geography "${row.geography}" not found`
        });
        continue;
      }

      const geographyType = GEOGRAPHY_TYPE_MAPPING[row.geography.toUpperCase()] || 
                           GEOGRAPHY_TYPE_MAPPING[geography.name.toUpperCase()] || 
                           'onshore';

      // Find client - extract from location/process name
      const clients = clientsByGeo.get(geography._id.toString()) || [];
      
      let client = null;
      
      // Try to extract client name from location or process_type
      // Pattern: "Offshore_Client_3_Process_18" -> "Offshore_Client_3"
      const clientPattern = /^(.*?_Client_\d+)/i;
      const locationMatch = row.location.match(clientPattern);
      const processMatch = row.process_type.match(clientPattern);
      
      const extractedClientName = locationMatch?.[1] || processMatch?.[1];
      
      if (extractedClientName) {
        // Find client by extracted name
        client = clients.find(c => 
          normalizeKey(c.name) === normalizeKey(extractedClientName) ||
          c.name.toLowerCase().includes(extractedClientName.toLowerCase())
        );
      }
      
      // Fallback: Take first client
      if (!client && clients.length > 0) {
        client = clients[0];
      }

      if (!client) {
        skippedRows.push({
          ...row,
          error: `No client found for geography "${geography.name}"`
        });
        continue;
      }

      // Find project
      const projects = projectsByClient.get(client._id.toString()) || [];
      const project = projects.find(p => 
        normalizeKey(p.name) === normalizeKey(row.process_type) ||
        p.name.toLowerCase() === row.process_type.toLowerCase()
      );

      if (!project) {
        skippedRows.push({
          ...row,
          error: `Process Type "${row.process_type}" not found under client "${client.name}"`
        });
        continue;
      }

      // Find subproject
      const subprojects = subprojectsByProject.get(project._id.toString()) || [];
      const subproject = subprojects.find(s => 
        normalizeKey(s.name) === normalizeKey(row.location) ||
        s.name.toLowerCase() === row.location.toLowerCase()
      );

      if (!subproject) {
        skippedRows.push({
          ...row,
          error: `Location "${row.location}" not found under process "${project.name}"`
        });
        continue;
      }

      // Create aggregation key
      const key = `${subproject._id.toString()}_${row.request_type}_${row.parsed_date.toISOString().split('T')[0]}`;

      if (!allocationMap.has(key)) {
        allocationMap.set(key, {
          geography_id: geography._id,
          geography_name: geography.name,
          geography_type: geographyType,
          client_id: client._id,
          client_name: client.name,
          project_id: project._id,
          project_name: project.name,
          subproject_id: subproject._id,
          subproject_name: subproject.name,
          request_type: row.request_type,
          allocation_date: row.parsed_date,
          day: row.day,
          month: row.month,
          year: row.year,
          count: 0,
          resource_names: []
        });
      }

      const entry = allocationMap.get(key);
      entry.count++;
      
      // Store unique resource names
      if (!entry.resource_names.includes(row.resource_name)) {
        entry.resource_names.push(row.resource_name);
      }
    }

    const processTime = ((Date.now() - processStart) / 1000).toFixed(2);
    console.log(`✅ Processed ${validRows.length} rows in ${processTime}s`);
    console.log(`📊 Created ${allocationMap.size} unique allocation records`);
    
    if (skippedRows.length > 0) {
      console.log(`⚠️  Skipped ${skippedRows.length} rows`);
      return sendErrorCsv(res, filePath, skippedRows);
    }

    // STEP 5: Delete existing data
    console.log('🗑️  Deleting existing data...');
    const deleteStart = Date.now();
    
    const deleteResult = await AllocationSummary.deleteMany({
      allocation_date: {
        $gte: minDate,
        $lte: maxDate
      }
    });
    
    const deleteTime = ((Date.now() - deleteStart) / 1000).toFixed(2);
    console.log(`✅ Deleted ${deleteResult.deletedCount} records in ${deleteTime}s`);

    // STEP 6: Bulk insert
    console.log('💾 Inserting data...');
    const insertStart = Date.now();
    
    const BATCH_SIZE = 5000;
    const processedData = Array.from(allocationMap.values());

    let totalInserted = 0;
    for (let i = 0; i < processedData.length; i += BATCH_SIZE) {
      const batch = processedData.slice(i, i + BATCH_SIZE);
      await AllocationSummary.insertMany(batch, { ordered: false });
      totalInserted += batch.length;
      
      if (processedData.length > 10000) {
        console.log(`  💾 Inserted ${totalInserted}/${processedData.length}...`);
      }
    }

    const insertTime = ((Date.now() - insertStart) / 1000).toFixed(2);
    console.log(`✅ Inserted ${totalInserted} records in ${insertTime}s`);

    // STEP 7: Save metadata
    const uniqueMonths = [...new Set(processedData.map(d => d.month))];
    const uniqueYears = [...new Set(processedData.map(d => d.year))];

    await AllocationUploadMeta.create({
      start_date: minDate,
      end_date: maxDate,
      total_records: validRows.length,
      unique_combinations: allocationMap.size,
      months: uniqueMonths.sort(),
      years: uniqueYears.sort()
    });

    fs.unlinkSync(filePath);

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n🎉 Upload completed in ${totalTime}s!`);

    return res.json({
      status: 'success',
      message: 'Allocation data uploaded successfully',
      summary: {
        totalRecords: validRows.length,
        uniqueCombinations: allocationMap.size,
        inserted: totalInserted,
        dateRange: {
          start: minDate.toISOString().split('T')[0],
          end: maxDate.toISOString().split('T')[0]
        },
        months: uniqueMonths.sort(),
        years: uniqueYears.sort(),
        processingTime: `${totalTime}s`
      }
    });

  } catch (err) {
    console.error('❌ Upload error:', err);
    console.error(err.stack);
    try { fs.unlinkSync(filePath); } catch {}
    return res.status(500).json({ error: err.message });
  }
});

// ... (other routes remain the same)

function sendErrorCsv(res, filePath, errors) {
  try {
    const fields = [
      '__row',
      'allocation_date',
      'resource_name',
      'request_type',
      'location',
      'process_type',
      'geography',
      'error'
    ];
    const parser = new Parser({ fields });
    const csvOut = parser.parse(errors);

    fs.unlinkSync(filePath);
    res.setHeader('Content-Disposition', 'attachment; filename=allocation-upload-errors.csv');
    res.setHeader('Content-Type', 'text/csv');
    return res.status(400).send(csvOut);
  } catch (err) {
    console.error('Error generating error CSV:', err);
    return res.status(500).json({ error: 'Error generating error report' });
  }
}


// =============================================
// GET ALLOCATION SUMMARY - WITH PAGINATION
// =============================================
// routes/allocation-upload.routes.js - UPDATE THE allocation-summary ROUTE

// routes/allocation-upload.routes.js - FIX THE allocation-summary ROUTE

const mongoose = require('mongoose'); // ADD THIS AT THE TOP IF NOT THERE

router.get('/allocation-summary', async (req, res) => {
  try {
    const { 
      year, 
      month, 
      start_date,
      end_date,
      client_id, 
      geography_id,
      geography_type, 
      project_id, 
      subproject_id,
      search,
      page = 1,
      limit = 50
    } = req.query;

    const query = {};

    if (year) query.year = parseInt(year);
    if (month && month !== 'all') query.month = parseInt(month);
    
    if (start_date || end_date) {
      query.allocation_date = {};
      if (start_date) query.allocation_date.$gte = new Date(start_date);
      if (end_date) query.allocation_date.$lte = new Date(end_date);
    }

    // FIX: CONVERT STRING IDs TO ObjectId
    if (geography_id) {
      query.geography_id = new mongoose.Types.ObjectId(geography_id);
      console.log('🌍 Filtering by geography:', geography_id);
    }
    
    if (geography_type) {
      query.geography_type = geography_type;
      console.log('🌍 Filtering by geography type:', geography_type);
    }
    if (client_id) {
      query.client_id = new mongoose.Types.ObjectId(client_id);
      // console.log('🏢 Filtering by client:', client_id);
    }

    if (project_id) {
      query.project_id = new mongoose.Types.ObjectId(project_id);
      console.log('📁 Filtering by project:', project_id);
    }
    
    if (subproject_id) {
      query.subproject_id = new mongoose.Types.ObjectId(subproject_id);
      console.log('📍 Filtering by subproject:', subproject_id);
    }

    
    if (search) {
      query.$or = [
        { subproject_name: { $regex: search, $options: 'i' } },
        { project_name: { $regex: search, $options: 'i' } }
      ];
    }

    console.log('🔍 Final Query filters:', JSON.stringify(query, null, 2));

    // Use aggregation pipeline for better performance
    const pipeline = [
      { $match: query },
      {
        $group: {
          _id: {
            subproject_id: '$subproject_id',
            project_id: '$project_id'
          },
          projectId: { $first: '$project_id' },
          processType: { $first: '$project_name' },
          subprojectId: { $first: '$subproject_id' },
          location: { $first: '$subproject_name' },
          geographyType: { $first: '$geography_type' },
          geographyName: { $first: '$geography_name' },
          
          duplicateHours: {
            $sum: {
              $cond: [{ $eq: ['$request_type', 'Duplicate'] }, '$count', 0]
            }
          },
          keyHours: {
            $sum: {
              $cond: [{ $eq: ['$request_type', 'Key'] }, '$count', 0]
            }
          },
          newRequestHours: {
            $sum: {
              $cond: [{ $eq: ['$request_type', 'New Request'] }, '$count', 0]
            }
          }
        }
      },
      {
        $project: {
          _id: 0,
          projectId: 1,
          processType: 1,
          subprojectId: 1,
          location: 1,
          geographyType: 1,
          geographyName: 1,
          duplicateHours: 1,
          keyHours: 1,
          newRequestHours: 1,
          totalCasesHours: {
            $add: ['$duplicateHours', '$keyHours', '$newRequestHours']
          }
        }
      },
      { $sort: { location: 1 } }
    ];

    // Get total count for pagination
    const countPipeline = [...pipeline, { $count: 'total' }];
    const countResult = await AllocationSummary.aggregate(countPipeline);
    const totalItems = countResult[0]?.total || 0;

    console.log('📊 Total items matching filters:', totalItems);

    // Add pagination
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    pipeline.push({ $skip: skip });
    pipeline.push({ $limit: limitNum });

    const aggregatedData = await AllocationSummary.aggregate(pipeline);

    console.log('📊 Aggregated Data Count for current page:', aggregatedData.length);

    // CONVERT ALL SUBPROJECT IDs TO STRINGS
    const subprojectIds = aggregatedData.map(item => item.subprojectId);

    console.log('🔍 Looking up rates for', subprojectIds.length, 'subprojects');

    // Fetch rates
    const requestTypeRates = await SubprojectRequestType.find({
      subproject_id: { $in: subprojectIds }
    }).lean();

    console.log('💰 Found', requestTypeRates.length, 'rate records');

    // Create rate lookup map
    const rateMap = new Map();
    
    requestTypeRates.forEach(rt => {
      const subprojectIdStr = rt.subproject_id.toString();
      const key = `${subprojectIdStr}_${rt.name}`;
      rateMap.set(key, rt.rate);
    });

    // Calculate billing
    const dataWithBilling = aggregatedData.map(item => {
      const subprojectIdStr = item.subprojectId.toString();
      
      const duplicateKey = `${subprojectIdStr}_Duplicate`;
      const keyKey = `${subprojectIdStr}_Key`;
      const newRequestKey = `${subprojectIdStr}_New Request`;
      
      const duplicateRate = rateMap.get(duplicateKey) || 0;
      const keyRate = rateMap.get(keyKey) || 0;
      const newRequestRate = rateMap.get(newRequestKey) || 0;

      const duplicateTotal = item.duplicateHours * duplicateRate;
      const keyTotal = item.keyHours * keyRate;
      const newRequestTotal = item.newRequestHours * newRequestRate;
      const totalBilling = duplicateTotal + keyTotal + newRequestTotal;

      return {
        ...item,
        duplicateTotal,
        keyTotal,
        newRequestTotal,
        totalBilling
      };
    });

    // Calculate totals for current page
    const totals = dataWithBilling.reduce((acc, item) => {
      acc.duplicateHours += item.duplicateHours;
      acc.duplicateTotal += item.duplicateTotal;
      acc.keyHours += item.keyHours;
      acc.keyTotal += item.keyTotal;
      acc.newRequestHours += item.newRequestHours;
      acc.newRequestTotal += item.newRequestTotal;
      acc.totalCasesHours += item.totalCasesHours;
      acc.totalBilling += item.totalBilling;
      return acc;
    }, {
      duplicateHours: 0,
      duplicateTotal: 0,
      keyHours: 0,
      keyTotal: 0,
      newRequestHours: 0,
      newRequestTotal: 0,
      totalCasesHours: 0,
      totalBilling: 0
    });

    // Calculate grand totals (across all pages)
    const grandTotalPipeline = [
      { $match: query },
      {
        $group: {
          _id: null,
          duplicateHours: {
            $sum: {
              $cond: [{ $eq: ['$request_type', 'Duplicate'] }, '$count', 0]
            }
          },
          keyHours: {
            $sum: {
              $cond: [{ $eq: ['$request_type', 'Key'] }, '$count', 0]
            }
          },
          newRequestHours: {
            $sum: {
              $cond: [{ $eq: ['$request_type', 'New Request'] }, '$count', 0]
            }
          }
        }
      }
    ];

    const grandTotalResult = await AllocationSummary.aggregate(grandTotalPipeline);
    const grandTotals = grandTotalResult[0] || {
      duplicateHours: 0,
      keyHours: 0,
      newRequestHours: 0
    };

    grandTotals.totalCasesHours = grandTotals.duplicateHours + grandTotals.keyHours + grandTotals.newRequestHours;

    const totalPages = Math.ceil(totalItems / limitNum);

    res.json({
      data: dataWithBilling,
      totals,
      grandTotals,
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
    console.error('❌ Error fetching allocation summary:', error);
    res.status(500).json({ error: error.message });
  }
});
// =============================================
// DIAGNOSTIC ENDPOINTS
// =============================================

router.get('/debug-rates', async (req, res) => {
  try {
    console.log('\n🔍 ===== DIAGNOSTIC REPORT =====\n');

    // 1. Check SubprojectRequestType collection
    const allRates = await SubprojectRequestType.find().lean();
    console.log('📊 Total rate records in database:', allRates.length);
    
    if (allRates.length === 0) {
      return res.json({
        error: 'NO RATES FOUND IN DATABASE!',
        message: 'You need to create SubprojectRequestType records with rates first.',
        instructions: 'Go to your Projects page and set rates for each location.'
      });
    }

    // 2. Group rates by subproject
    const ratesBySubproject = {};
    allRates.forEach(rate => {
      const subId = rate.subproject_id.toString();
      if (!ratesBySubproject[subId]) {
        ratesBySubproject[subId] = [];
      }
      ratesBySubproject[subId].push({
        name: rate.name,
        rate: rate.rate
      });
    });

    console.log('📋 Rates grouped by subproject:', Object.keys(ratesBySubproject).length, 'subprojects');

    // 3. Check AllocationSummary collection
    const allocations = await AllocationSummary.find().limit(10).lean();
    console.log('📊 Total allocation records:', await AllocationSummary.countDocuments());
    
    if (allocations.length === 0) {
      return res.json({
        error: 'NO ALLOCATION DATA FOUND!',
        message: 'Upload your allocation CSV first.'
      });
    }

    // 4. Check if allocation subproject_ids match rate subproject_ids
    const allocationSubprojects = [...new Set(allocations.map(a => a.subproject_id.toString()))];
    const rateSubprojects = Object.keys(ratesBySubproject);

    console.log('🔍 Allocation subprojects:', allocationSubprojects);
    console.log('🔍 Rate subprojects:', rateSubprojects);

    const matchingSubprojects = allocationSubprojects.filter(id => rateSubprojects.includes(id));
    const missingRates = allocationSubprojects.filter(id => !rateSubprojects.includes(id));

    console.log('✅ Matching subprojects:', matchingSubprojects.length);
    console.log('❌ Subprojects with NO rates:', missingRates.length);

    // 5. Get actual subproject names for missing rates
    const missingSubprojects = await Subproject.find({
      _id: { $in: missingRates }
    }).select('name').lean();

    // 6. Sample rate calculations
    const sampleCalculations = allocations.slice(0, 3).map(alloc => {
      const subId = alloc.subproject_id.toString();
      const rates = ratesBySubproject[subId] || [];
      const matchingRate = rates.find(r => r.name === alloc.request_type);

      return {
        location: alloc.subproject_name,
        processType: alloc.project_name,
        requestType: alloc.request_type,
        count: alloc.count,
        subprojectId: subId,
        rate: matchingRate ? matchingRate.rate : 0,
        billing: matchingRate ? (alloc.count * matchingRate.rate) : 0,
        hasRate: !!matchingRate
      };
    });

    console.log('💰 Sample calculations:', JSON.stringify(sampleCalculations, null, 2));

    // Return diagnostic report
    return res.json({
      status: 'Diagnostic Complete',
      summary: {
        totalRates: allRates.length,
        totalAllocations: await AllocationSummary.countDocuments(),
        subprojectsWithRates: rateSubprojects.length,
        allocationSubprojects: allocationSubprojects.length,
        matchingSubprojects: matchingSubprojects.length,
        missingRates: missingRates.length
      },
      ratesBySubproject: Object.entries(ratesBySubproject).slice(0, 10).map(([subId, rates]) => ({
        subprojectId: subId,
        rates: rates
      })),
      missingRateSubprojects: missingSubprojects.map(s => ({
        id: s._id.toString(),
        name: s.name
      })),
      sampleCalculations,
      recommendation: missingRates.length > 0 
        ? `You have ${missingRates.length} locations without rates. Please set rates for: ${missingSubprojects.map(s => s.name).join(', ')}`
        : 'All allocations have corresponding rates! The issue might be in the rate lookup logic.'
    });

  } catch (error) {
    console.error('❌ Diagnostic error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/debug-mismatch', async (req, res) => {
  try {
    // Get allocation subproject
    const allocationSample = await AllocationSummary.findOne().lean();
    
    if (!allocationSample) {
      return res.json({ error: 'No allocation data found' });
    }
    
    const allocSubproject = await Subproject.findById(allocationSample.subproject_id).lean();
    
    // Get rate subprojects
    const rateSubprojectIds = await SubprojectRequestType.distinct('subproject_id');
    const rateSubprojects = await Subproject.find({
      _id: { $in: rateSubprojectIds }
    }).limit(10).lean();

    return res.json({
      allocationData: {
        subprojectId: allocationSample.subproject_id.toString(),
        subprojectName: allocationSample.subproject_name,
        projectName: allocationSample.project_name,
        actualSubproject: allocSubproject
      },
      rateSubprojects: rateSubprojects.map(s => ({
        id: s._id.toString(),
        name: s.name,
        projectName: s.project_name
      })),
      comparison: {
        allocationSubprojectName: allocSubproject?.name,
        rateSubprojectNames: rateSubprojects.map(s => s.name),
        possibleMatch: rateSubprojects.find(s => 
          s.name.toLowerCase().includes(allocSubproject?.name.toLowerCase()) ||
          allocSubproject?.name.toLowerCase().includes(s.name.toLowerCase())
        )
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =============================================
// GET UPLOAD HISTORY
// =============================================
router.get('/upload-history', async (req, res) => {
  try {
    const { limit = 10 } = req.query;

    const history = await AllocationUploadMeta.find()
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
// GET LATEST UPLOAD INFO
// =============================================
router.get('/latest-upload', async (req, res) => {
  try {
    const latestUpload = await AllocationUploadMeta.findOne()
      .sort({ upload_date: -1 })
      .lean();

    if (!latestUpload) {
      return res.json({ message: 'No upload history found' });
    }

    res.json({ upload: latestUpload });

  } catch (error) {
    console.error('Error fetching latest upload:', error);
    res.status(500).json({ error: error.message });
  }
});

// =============================================
// DELETE ALLOCATION DATA
// =============================================
router.delete('/allocation-data', async (req, res) => {
  try {
    const { year, month } = req.query;

    const query = {};
    if (year) query.year = parseInt(year);
    if (month) query.month = parseInt(month);

    const result = await AllocationSummary.deleteMany(query);

    res.json({
      message: 'Allocation data deleted successfully',
      deletedCount: result.deletedCount
    });

  } catch (error) {
    console.error('Error deleting allocation data:', error);
    res.status(500).json({ error: error.message });
  }
});
// routes/allocation-upload.routes.js - ADD NEW EXPORT ENDPOINT

router.get('/allocation-summary-export', async (req, res) => {
  try {
    const { 
      year, 
      month, 
      start_date,
      end_date,
      geography_id,
      geography_type, 
      project_id, 
      subproject_id,
      search
    } = req.query;

    const query = {};

    if (year) query.year = parseInt(year);
    if (month && month !== 'all') query.month = parseInt(month);
    
    if (start_date || end_date) {
      query.allocation_date = {};
      if (start_date) query.allocation_date.$gte = new Date(start_date);
      if (end_date) query.allocation_date.$lte = new Date(end_date);
    }

    if (geography_id) query.geography_id = geography_id;
    if (geography_type) query.geography_type = geography_type;
    if (project_id) query.project_id = project_id;
    if (subproject_id) query.subproject_id = subproject_id;
    
    if (search) {
      query.$or = [
        { subproject_name: { $regex: search, $options: 'i' } },
        { project_name: { $regex: search, $options: 'i' } }
      ];
    }

    console.log('📥 Export - Query filters:', JSON.stringify(query, null, 2));

    // NO PAGINATION - GET ALL DATA
    const pipeline = [
      { $match: query },
      {
        $group: {
          _id: {
            subproject_id: '$subproject_id',
            project_id: '$project_id'
          },
          projectId: { $first: '$project_id' },
          processType: { $first: '$project_name' },
          subprojectId: { $first: '$subproject_id' },
          location: { $first: '$subproject_name' },
          geographyType: { $first: '$geography_type' },
          geographyName: { $first: '$geography_name' },
          
          duplicateHours: {
            $sum: {
              $cond: [{ $eq: ['$request_type', 'Duplicate'] }, '$count', 0]
            }
          },
          keyHours: {
            $sum: {
              $cond: [{ $eq: ['$request_type', 'Key'] }, '$count', 0]
            }
          },
          newRequestHours: {
            $sum: {
              $cond: [{ $eq: ['$request_type', 'New Request'] }, '$count', 0]
            }
          }
        }
      },
      {
        $project: {
          _id: 0,
          projectId: 1,
          processType: 1,
          subprojectId: 1,
          location: 1,
          geographyType: 1,
          geographyName: 1,
          duplicateHours: 1,
          keyHours: 1,
          newRequestHours: 1,
          totalCasesHours: {
            $add: ['$duplicateHours', '$keyHours', '$newRequestHours']
          }
        }
      },
      { $sort: { location: 1 } }
    ];

    const allData = await AllocationSummary.aggregate(pipeline);

    console.log('📊 Export - Retrieved', allData.length, 'records');

    // Fetch rates
    const subprojectIds = allData.map(item => item.subprojectId);
    const requestTypeRates = await SubprojectRequestType.find({
      subproject_id: { $in: subprojectIds }
    }).lean();

    // Create rate lookup map
    const rateMap = new Map();
    requestTypeRates.forEach(rt => {
      const subprojectIdStr = rt.subproject_id.toString();
      const key = `${subprojectIdStr}_${rt.name}`;
      rateMap.set(key, rt.rate);
    });

    // Calculate billing
    const dataWithBilling = allData.map(item => {
      const subprojectIdStr = item.subprojectId.toString();
      
      const duplicateRate = rateMap.get(`${subprojectIdStr}_Duplicate`) || 0;
      const keyRate = rateMap.get(`${subprojectIdStr}_Key`) || 0;
      const newRequestRate = rateMap.get(`${subprojectIdStr}_New Request`) || 0;

      const duplicateTotal = item.duplicateHours * duplicateRate;
      const keyTotal = item.keyHours * keyRate;
      const newRequestTotal = item.newRequestHours * newRequestRate;
      const totalBilling = duplicateTotal + keyTotal + newRequestTotal;

      return {
        ...item,
        duplicateTotal,
        keyTotal,
        newRequestTotal,
        totalBilling
      };
    });

    // Calculate totals
    const totals = dataWithBilling.reduce((acc, item) => {
      acc.duplicateHours += item.duplicateHours;
      acc.duplicateTotal += item.duplicateTotal;
      acc.keyHours += item.keyHours;
      acc.keyTotal += item.keyTotal;
      acc.newRequestHours += item.newRequestHours;
      acc.newRequestTotal += item.newRequestTotal;
      acc.totalCasesHours += item.totalCasesHours;
      acc.totalBilling += item.totalBilling;
      return acc;
    }, {
      duplicateHours: 0,
      duplicateTotal: 0,
      keyHours: 0,
      keyTotal: 0,
      newRequestHours: 0,
      newRequestTotal: 0,
      totalCasesHours: 0,
      totalBilling: 0
    });

    res.json({
      data: dataWithBilling,
      totals
    });

  } catch (error) {
    console.error('❌ Error exporting data:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;