// routes/invoice.js
const express = require('express');
const router = express.Router();
const Invoice = require('../models/Invoices');
const Billing = require('../models/Billing');

// --- MIDDLEWARE: Convert billing IDs to full billing objects ---
const convertBillingIdsToObjects = async (req, res, next) => {
  try {
    const { billing_records } = req.body;

    if (!billing_records || !Array.isArray(billing_records)) {
      return next();
    }

    // Check if billing_records contains IDs (strings) or objects
    const hasIds = billing_records.some(record => 
      typeof record === 'string' || 
      (typeof record === 'object' && record.constructor.name === 'ObjectId')
    );

    if (hasIds) {
      // Fetch full billing records from database
      const billingIds = billing_records.map(id => id.toString ? id.toString() : id);
      const billingDocs = await Billing.find({ _id: { $in: billingIds } });

      if (billingDocs.length !== billingIds.length) {
        return res.status(400).json({ 
          message: 'Some billing records not found',
          found: billingDocs.length,
          requested: billingIds.length
        });
      }

      // Convert to plain objects with all fields
      req.body.billing_records = billingDocs.map(bill => ({
        project_id: bill.project_id,
        subproject_id: bill.subproject_id,
        project_name: bill.project_name,
        subproject_name: bill.subproject_name,
        resource_id: bill.resource_id,
        resource_name: bill.resource_name,
        productivity_level: bill.productivity_level,
        hours: bill.hours,
        rate: bill.rate,
        flatrate: bill.flatrate || 0,
        costing: bill.costing,
        total_amount: bill.billable_status==='Billable'?bill.total_amount:0,
        billable_status: bill.billable_status || 'Non-Billable',
        description: bill.description,
        month: bill.month,
        year: bill.year,
        original_billing_id: bill._id
      }));


    }

    next();
  } catch (error) {
    console.error('Error in convertBillingIdsToObjects middleware:', error);
    res.status(500).json({ 
      message: 'Failed to process billing records', 
      error: error.message 
    });
  }
};

// --- CREATE INVOICE ---
router.post('/', convertBillingIdsToObjects, async (req, res) => {
  try {
    const { billing_records } = req.body;

    if (!billing_records || !billing_records.length) {
      return res.status(400).json({ 
        message: 'Billing records are required.' 
      });
    }

    // Create invoice with embedded billing data
    const invoice = new Invoice({ 
      billing_records
    });
    
    await invoice.calculateTotals();
    await invoice.save();

    res.status(201).json(invoice);
  } catch (error) {
    console.error(error);
    res.status(500).json({ 
      message: 'Failed to create invoice', 
      error: error.message 
    });
  }
});

// --- GET ALL INVOICES ---
router.get('/', async (req, res) => {
  try {
    const invoices = await Invoice.find()
      .populate([
        { path: 'billing_records.project_id', select: 'name' },
        { path: 'billing_records.subproject_id', select: 'name' },
        { path: 'billing_records.resource_id', select: 'name' }
      ])
      .sort({ createdAt: -1 });

    // Enhance with populated names
    const invoicesWithNames = invoices.map(inv => {
      const invObj = inv.toObject();
      invObj.billing_records = invObj.billing_records.map(bill => ({
        ...bill,
        project_name: bill.project_id?.name || bill.project_name || null,
        subproject_name: bill.subproject_id?.name || bill.subproject_name || null,
        resource_name: bill.resource_id?.name || bill.resource_name || null,
      }));
      return invObj;
    });

    res.json(invoicesWithNames);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to fetch invoices' });
  }
});

// --- GET SINGLE INVOICE ---
router.get('/:id', async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id)
      .populate([
        { path: 'billing_records.project_id', select: 'name' },
        { path: 'billing_records.subproject_id', select: 'name' },
        { path: 'billing_records.resource_id', select: 'name' }
      ]);

    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    // Enhance with populated names
    const invObj = invoice.toObject();
    invObj.billing_records = invObj.billing_records.map(bill => ({
      ...bill,
      project_name: bill.project_id?.name || bill.project_name || null,
      subproject_name: bill.subproject_id?.name || bill.subproject_name || null,
      resource_name: bill.resource_id?.name || bill.resource_name || null,
    }));

    res.json(invObj);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to fetch invoice' });
  }
});

// --- DELETE INVOICE ---
router.delete('/:id', async (req, res) => {
  try {
    const invoice = await Invoice.findByIdAndDelete(req.params.id);
    
    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    res.json({ message: 'Invoice deleted successfully', invoice });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to delete invoice' });
  }
});

// --- UPDATE INVOICE (with middleware) ---
router.put('/:id', convertBillingIdsToObjects, async (req, res) => {
  try {
    const { billing_records  } = req.body;

    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    // Update billing records if provided
    if (billing_records && billing_records.length) {
      invoice.billing_records = billing_records;
    }

    // Recalculate totals
    await invoice.calculateTotals();
    await invoice.save();

    res.json(invoice);
  } catch (error) {
    console.error(error);
    res.status(500).json({ 
      message: 'Failed to update invoice', 
      error: error.message 
    });
  }
});

// --- PATCH INVOICE (partial update with middleware) ---
router.patch('/:id', convertBillingIdsToObjects, async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    const { billing_records, ...otherFields } = req.body;

    // Update billing records if provided
    if (billing_records && billing_records.length) {
      invoice.billing_records = billing_records;

    }

    // Update other fields
    Object.keys(otherFields).forEach(key => {
      if (key !== 'invoice_number') { // Prevent invoice number modification
        invoice[key] = otherFields[key];
      }
    });

    // Recalculate totals
    await invoice.calculateTotals();
    await invoice.save();

    res.json(invoice);
  } catch (error) {
    console.error(error);
    res.status(500).json({ 
      message: 'Failed to patch invoice', 
      error: error.message 
    });
  }
});

// --- OPTIONAL: If you want to keep invoices immutable, uncomment these ---
// router.put('/:id', (req, res) => {
//   return res.status(403).json({ message: 'Invoices cannot be modified once generated.' });
// });
// router.patch('/:id', (req, res) => {
//   return res.status(403).json({ message: 'Invoices cannot be modified once generated.' });
// });

module.exports = router;