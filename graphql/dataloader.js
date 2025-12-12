const DataLoader = require('dataloader');
const Project = require('./models/Project');
const Subproject = require('./models/Subproject');
const SubprojectProductivity = require('./models/SubprojectProductivity');
const Resource = require('./models/Resource');
const Billing = require('./models/Billing');

module.exports = function createLoaders() {
  return {
    projectsById: new DataLoader(async (ids) => {
      const docs = await Project.find({ _id: { $in: ids } });
      const map = new Map(docs.map(d => [String(d._id), d]));
      return ids.map(id => map.get(String(id)) || null);
    }),
    subprojectsById: new DataLoader(async (ids) => {
      const docs = await Subproject.find({ _id: { $in: ids } });
      const map = new Map(docs.map(d => [String(d._id), d]));
      return ids.map(id => map.get(String(id)) || null);
    }),
    productivityBySubprojectId: new DataLoader(async (subIds) => {
      const docs = await SubprojectProductivity.find({ subproject_id: { $in: subIds } });
      const grouped = subIds.map(sid => docs.filter(d => String(d.subproject_id) === String(sid)));
      return grouped;
    }),
    resourcesById: new DataLoader(async (ids) => {
      const docs = await Resource.find({ _id: { $in: ids } });
      const map = new Map(docs.map(d => [String(d._id), d]));
      return ids.map(id => map.get(String(id)) || null);
    }),
    billingBySubproject: new DataLoader(async (subIds) => {
      const docs = await Billing.find({ subproject_id: { $in: subIds } });
      const grouped = subIds.map(sid => docs.filter(d => String(d.subproject_id) === String(sid)));
      return grouped;
    })
  };
};
