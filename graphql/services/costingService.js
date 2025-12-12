const _ = require('lodash');
const Project = require('../models/Project');
const Subproject = require('../models/Subproject');
const Resource = require('../models/Resource');
const Productivity = require('../models/SubprojectProductivity');
const Billing = require('../models/Billing');
const cache = require('../cache');

// Utility: default productivity label if absent
const DEFAULT_PRODUCTIVITY = 'Medium';

function normalizeLevel(level) {
  if (!level) return DEFAULT_PRODUCTIVITY;
  return String(level).toLowerCase() === 'best' ? 'Best' :
         String(level).charAt(0).toUpperCase() + String(level).slice(1).toLowerCase();
}

async function fetchAllProjectsAndSubprojects() {
  const projects = await Project.find().lean();
  const subprojects = await Subproject.find().lean();
  // Attach subprojects to project map
  return { projects, subprojects };
}

/**
 * Primary function: returns processed rows for the costing UI
 * It caches results per month/year to speed up repeated calls.
 */
async function getCostingRows({ month, year }) {
  const cacheKey = `costing:${year}:${month}`;
  const cached = await cache.get(cacheKey);
  if (cached) return cached;

  // Load basic data
  const [projects, subprojects, resources, billingRecords] = await Promise.all([
    Project.find().lean(),
    Subproject.find().lean(),
    Resource.find().lean(),
    Billing.find({ $or: [{ month, year }, { month: null }] }).lean()
  ]);

  // Build maps for quick lookup
  const projectMap = new Map(projects.map(p => [String(p._id), p]));
  const subprojectMap = new Map(subprojects.map(sp => [String(sp._id), sp]));
  const resourceMap = new Map(resources.map(r => [String(r._id), r]));

  // Build billing map: use highest priority (month/year) first
  const billingMap = new Map();
  billingRecords.forEach(b => {
    const sid = b.subproject_id ? String(b.subproject_id) : null;
    const key = `${sid}-${String(b.resource_id)}`;
    // If monthly record exists, prefer it
    if (!billingMap.has(key) || (b.month !== null && b.month === month && b.year === year)) {
      billingMap.set(key, b);
    }
  });

  // Load productivity for subprojects in bulk
  const productivityRecords = await Productivity.find({ subproject_id: { $in: subprojects.map(s => s._id) } }).lean();
  const productivityMap = _.groupBy(productivityRecords, r => String(r.subproject_id));

  // Accumulate final rows in a map to avoid duplicates
  const finalRows = new Map();

  // Pass 1: Active assignments from resources
  for (const res of resources) {
    const assignedSubs = res.assigned_subprojects || [];
    for (const spId of assignedSubs) {
      const sp = subprojectMap.get(String(spId));
      if (!sp) continue;
      const proj = projectMap.get(String(sp.project_id));
      if (!proj) continue;

      const uniqueKey = `${String(sp._id)}-${String(res._id)}`;
      const billing = billingMap.get(`${String(sp._id)}-${String(res._id)}`);
      const ratesForSp = productivityMap[String(sp._id)] || [];
      const defaultRate = ratesForSp.find(r => r.level.toLowerCase() === DEFAULT_PRODUCTIVITY.toLowerCase());

      let row;
      if (billing) {
        const matchedRate = ratesForSp.find(r => r.level.toLowerCase() === (billing.productivity_level || '').toLowerCase());
        const rateValue = matchedRate ? matchedRate.base_rate : (defaultRate ? defaultRate.base_rate : 0);
        row = {
          uniqueId: `${proj._id}-${sp._id}-${res._id}`,
          projectId: proj._id,
          projectName: proj.name,
          subprojectId: sp._id,
          subProjectName: sp.name,
          resource: {
            id: res._id,
            name: res.name,
            avatar_url: res.avatar_url || '',
            role: res.role || ''
          },
          hours: billing.hours || 0,
          productivity: normalizeLevel(billing.productivity_level) || DEFAULT_PRODUCTIVITY,
          rate: rateValue,
          flatrate: sp.flatrate ?? 0,
          costingAmount: (billing.hours || 0) * (rateValue || 0),
          totalBillAmount: (billing.hours || 0) * (sp.flatrate ?? 0),
          isBillable: billing.billable_status === 'Billable',
          description: billing.description || '',
          billingId: billing._id || null,
          isEditable: true
        };
      } else {
        row = {
          uniqueId: `${proj._id}-${sp._id}-${res._id}`,
          projectId: proj._id,
          projectName: proj.name,
          subprojectId: sp._id,
          subProjectName: sp.name,
          resource: {
            id: res._id,
            name: res.name,
            avatar_url: res.avatar_url || '',
            role: res.role || ''
          },
          hours: 0,
          productivity: DEFAULT_PRODUCTIVITY,
          rate: defaultRate ? defaultRate.base_rate : 0,
          flatrate: sp.flatrate ?? 0,
          costingAmount: 0,
          totalBillAmount: 0,
          isBillable: true,
          description: '',
          billingId: null,
          isEditable: true
        };
      }

      finalRows.set(uniqueKey, row);
    }
  }

  // Pass 2: Historical / orphaned records (billing rows not matched above)
  for (const billing of billingRecords) {
    if (billing.month === null) continue; // skip templates
    const subId = billing.subproject_id ? String(billing.subproject_id) : null;
    const key = `${subId}-${String(billing.resource_id)}`;
    if (finalRows.has(key)) continue;
    const res = resourceMap.get(String(billing.resource_id));
    const sp = subprojectMap.get(subId);
    const proj = sp ? projectMap.get(String(sp.project_id)) : null;

    const ratesForSp = productivityMap[subId] || [];
    const matchedRate = ratesForSp.find(r => r.level.toLowerCase() === (billing.productivity_level || '').toLowerCase());
    const rateValue = matchedRate ? matchedRate.base_rate : (ratesForSp.find(r => r.level.toLowerCase() === DEFAULT_PRODUCTIVITY.toLowerCase()) || { base_rate: 0 }).base_rate;

    if (!proj || !sp) {
      // orphaned row, still include but mark non-editable
      finalRows.set(key, {
        uniqueId: `${billing._id}`,
        projectId: null,
        projectName: billing.project_name || 'Unknown Project',
        subprojectId: billing.subproject_id || null,
        subProjectName: billing.subproject_name || billing.subproject_name || 'Unknown Subproject',
        resource: {
          id: billing.resource_id,
          name: billing.resource_name || `Deleted Resource (${billing.resource_id})`,
          avatar_url: billing.avatar_url || 'https://placehold.co/40x40/f3f4f6/374151?text=DLT',
          role: 'N/A'
        },
        hours: billing.hours || 0,
        productivity: normalizeLevel(billing.productivity_level) || DEFAULT_PRODUCTIVITY,
        rate: rateValue,
        flatrate: billing.flatrate ?? 0,
        costingAmount: (billing.hours || 0) * rateValue,
        totalBillAmount: (billing.hours || 0) * (billing.flatrate ?? 0),
        isBillable: billing.billable_status === 'Billable',
        description: billing.description || '',
        billingId: billing._id,
        isEditable: false
      });
    } else {
      finalRows.set(key, {
        uniqueId: `${proj._id}-${sp._id}-${billing.resource_id}`,
        projectId: proj._id,
        projectName: proj.name,
        subprojectId: sp._id,
        subProjectName: sp.name,
        resource: {
          id: billing.resource_id,
          name: res ? res.name : (billing.resource_name || `Deleted Resource (${billing.resource_id})`),
          avatar_url: res ? res.avatar_url : 'https://placehold.co/40x40/f3f4f6/374151?text=DLT',
          role: res ? res.role : 'N/A'
        },
        hours: billing.hours || 0,
        productivity: normalizeLevel(billing.productivity_level) || DEFAULT_PRODUCTIVITY,
        rate: rateValue,
        flatrate: sp.flatrate ?? 0,
        costingAmount: (billing.hours || 0) * rateValue,
        totalBillAmount: (billing.hours || 0) * (sp.flatrate ?? 0),
        isBillable: billing.billable_status === 'Billable',
        description: billing.description || '',
        billingId: billing._id,
        isEditable: false
      });
    }
  }

  // Convert to array and cache
  const rowsArray = Array.from(finalRows.values());
  await cache.set(cacheKey, rowsArray, parseInt(process.env.CACHE_TTL_SECONDS || '300', 10));
  return rowsArray;
}

module.exports = {
  getCostingRows,
};
