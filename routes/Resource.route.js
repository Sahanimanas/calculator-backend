const express = require('express');
const router = express.Router();
const Resource = require('../models/Resource');
const Project = require('../models/Project');
const Subproject = require('../models/Subproject.js');
const mongoose = require('mongoose');   
// const multer = require('multer');
// const csv = require('csv-parser');
// const fs = require('fs');
// const upload = multer({ dest: 'tmp/csv/' });

// --- GET resources with filters ---
router.get('/', async (req, res) => {
  try {
    const { role, billable_status, project_id, search } = req.query;

    let query = Resource.find();

    if (role) query = query.where('role').equals(role);
    if (billable_status) query = query.where('billable_status').equals(billable_status);
    if (project_id) query = query.where('assigned_projects').in([project_id]);
    if (search) {
      query = query.or([
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ]);
    }

    const resources = await query
      .populate('assigned_projects', 'name')
      .populate('assigned_subprojects', 'name')
      .sort({ createdAt: -1 });

    res.json(resources);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// --- GET single resource ---
router.get('/:id', async (req, res) => {
  const resource = await Resource.findById(req.params.id)
    .populate('assigned_projects', 'name')
    .populate('assigned_subprojects', 'name');
  if (!resource) return res.status(404).json({ message: 'Resource not found' });
  res.json(resource);
});

// --- CREATE resource ---
router.post('/', async (req, res) => {
  try {
    let { name, role, email, assigned_projects, assigned_subprojects, avatar_url } = req.body;

    // 1️⃣ Basic validation
    if (!name || !role || !email) {
      return res.status(400).json({ message: 'Name, role, and email are required' });
    }
  if(!avatar_url){
    avatar_url="https://imgs.search.brave.com/TJfABfGoj8ozO-c1s6H0C8LH0vqWWZvcck4eEPo6f5U/rs:fit:500:0:1:0/g:ce/aHR0cHM6Ly9tZWRp/YS5pc3RvY2twaG90/by5jb20vaWQvMTMz/NzE0NDE0Ni92ZWN0/b3IvZGVmYXVsdC1h/dmF0YXItcHJvZmls/ZS1pY29uLXZlY3Rv/ci5qcGc_cz02MTJ4/NjEyJnc9MCZrPTIw/JmM9QkliRnd1djdG/eFRXdmg1UzN2QjZi/a1QwUXY4Vm44TjVG/ZnNlcTg0Q2xHST0";
  }

    // 2️⃣ Check for duplicate email
    const existing = await Resource.findOne({ email });
    if (existing) {
      return res.status(400).json({ message: 'Email already exists' });
    }

    // 3️⃣ Validate ObjectIds if provided
    const validProjectIds = Array.isArray(assigned_projects)
      ? assigned_projects.filter(id => mongoose.Types.ObjectId.isValid(id))
      : [];

    const validSubProjectIds = Array.isArray(assigned_subprojects)
      ? assigned_subprojects.filter(id => mongoose.Types.ObjectId.isValid(id))
      : [];

    // 4️⃣ Create new resource
    const resource = new Resource({
      name,
      role,
      email,
      avatar_url: avatar_url || '',
      assigned_projects: validProjectIds,
      assigned_subprojects: validSubProjectIds,
    });

    await resource.save();

    // 5️⃣ Respond with success
    res.status(201).json({
      message: 'Resource created successfully',
      resource,
    });

  } catch (err) {
    console.error('Error creating resource:', err);
    res.status(500).json({ message: err.message });
  }
});


// --- UPDATE resource ---
router.put('/:id', async (req, res) => {
  try {
    const resource = await Resource.findById(req.params.id);
    if (!resource) return res.status(404).json({ message: 'Resource not found' });

    // prevent duplicate email
    if (req.body.email && req.body.email !== resource.email) {
      const exists = await Resource.findOne({ email: req.body.email });
      if (exists) return res.status(400).json({ message: 'Email already exists' });
    }

    Object.assign(resource, req.body);
    await resource.save();
    res.json(resource);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// --- DELETE resource ---
router.delete('/:id', async (req, res) => {
  try {
    const resource = await Resource.findById(req.params.id);
    if (!resource) return res.status(404).json({ message: 'Resource not found' });
    await resource.deleteOne();
    res.json({ message: 'Resource deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// --- TOGGLE billable status ---
router.post('/:id/toggle-billable', async (req, res) => {
  try {
    const resource = await Resource.findById(req.params.id);
    if (!resource) return res.status(404).json({ message: 'Resource not found' });

    resource.billable_status = resource.billable_status === 'Billable' ? 'Non-Billable' : 'Billable';
    resource.billable_inherited = false; // overridden
    await resource.save();

    res.json({ message: `Billable status changed to ${resource.billable_status}`, resource });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// // --- BULK create resources via CSV ---
// router.post('/upload_csv', upload.single('file'), async (req, res) => {
//   if (!req.file) return res.status(400).json({ message: 'CSV file required' });

//   const results = [];
//   const skipped = [];

//   fs.createReadStream(req.file.path)
//     .pipe(csv())
//     .on('data', (row) => {
//       if (!row.email) {
//         skipped.push({ row, reason: 'Missing email' });
//         return;
//       }
//       results.push(row);
//     })
//     .on('end', async () => {
//       const created = [];
//       for (let row of results) {
//         try {
//           const exists = await Resource.findOne({ email: row.email });
//           if (exists) {
//             skipped.push({ row, reason: 'Email exists' });
//             continue;
//           }
//           const resource = new Resource({
//             name: row.name,
//             role: row.role,
//             email: row.email,
//             assigned_projects: row.assigned_projects ? row.assigned_projects.split(',') : [],
//             assigned_subprojects: row.assigned_subprojects ? row.assigned_subprojects.split(',') : [],
//             billable_status: row.billable_status || 'Billable',
//             billable_inherited: row.billable_inherited !== 'false',
//             avatar_url: row.avatar_url || ''
//           });
//           await resource.save();
//           created.push(resource.email);
//         } catch (err) {
//           skipped.push({ row, reason: err.message });
//         }
//       }
//       fs.unlinkSync(req.file.path); // cleanup
//       res.json({ created, skipped, message: `${created.length} resources created` });
//     });
// });

module.exports = router;
