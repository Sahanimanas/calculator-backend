// routes/invoice.js
const express = require('express');
const router = express.Router();
const Invoice = require('../models/Invoices');
const Billing = require('../models/Billing');

// --- HELPER: Map DB Billing Doc to Invoice Record Schema ---
const mapBillingToInvoiceRecord = (bill) => ({
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
  // Only include revenue amount if it's billable
  total_amount: bill.billable_status === 'Billable' ? bill.total_amount : 0,
  billable_status: bill.billable_status || 'Non-Billable',
  description: bill.description,
  month: bill.month,
  year: bill.year,
  original_billing_id: bill._id
});

// --- MIDDLEWARE: Prepare Billing Data ---
// Handles both [Array of IDs] AND { Filters } for large datasets
const prepareInvoiceData = async (req, res, next) => {
  try {
    let billingDocs = [];

    // SCENARIO 1: Client sent an array of specific Billing IDs
    if (req.body.billing_records && Array.isArray(req.body.billing_records) && req.body.billing_records.length > 0) {
      
      const hasIds = req.body.billing_records.some(record => 
        typeof record === 'string' || 
        (typeof record === 'object' && record.constructor.name === 'ObjectId')
      );

      if (hasIds) {
        const billingIds = req.body.billing_records.map(id => id.toString ? id.toString() : id);
        billingDocs = await Billing.find({ _id: { $in: billingIds } });
      }
    } 
    // SCENARIO 2: Client sent Filters (Month, Year, Project) - Essential for pagination
    else if (req.body.month && req.body.year) {
      const query = {
        month: req.body.month,
        year: req.body.year,
        hours: { $gt: 0 } // Only invoice records with actual hours
      };

      if (req.body.project_id) query.project_id = req.body.project_id;
      if (req.body.subproject_id) query.subproject_id = req.body.subproject_id;

      billingDocs = await Billing.find(query);
      
      if (billingDocs.length === 0) {
        return res.status(404).json({ 
          message: 'No billing records found matching the provided filters.' 
        });
      }
    }

    // If we found docs, format them for the Invoice Model
    if (billingDocs.length > 0) {
      req.body.billing_records = billingDocs.map(mapBillingToInvoiceRecord);
    }

    next();
  } catch (error) {
    console.error('Error in prepareInvoiceData middleware:', error);
    res.status(500).json({ 
      message: 'Failed to process invoice data', 
      error: error.message 
    });
  }
};

// --- CREATE INVOICE ---
router.post('/', prepareInvoiceData, async (req, res) => {
  try {
    const { billing_records, month, year, project_id } = req.body;

    if (!billing_records || !billing_records.length) {
      return res.status(400).json({ 
        message: 'No billing records available to invoice.' 
      });
    }

    // Create invoice with embedded billing data
    const invoice = new Invoice({ 
      billing_records,
      metadata: {
        generated_via: month && year ? 'filter' : 'selection',
        month_ref: month,
        year_ref: year,
        project_ref: project_id
      }
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
      .select('-billing_records') // Optimization: Don't load massive billing arrays for list view
      .sort({ createdAt: -1 });

    res.json(invoices);
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
    
    // Convert to object to handle potential null populates gracefully
    const invObj = invoice.toObject();
    if(invObj.billing_records) {
        invObj.billing_records = invObj.billing_records.map(bill => ({
        ...bill,
        project_name: bill.project_name || bill.project_id?.name || 'Unknown',
        subproject_name: bill.subproject_name || bill.subproject_id?.name || 'Unknown',
        resource_name: bill.resource_name || bill.resource_id?.name || 'Unknown',
        }));
    }

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
    if (!invoice) return res.status(404).json({ message: 'Invoice not found' });
    res.json({ message: 'Invoice deleted successfully', invoice });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete invoice' });
  }
});

// --- UPDATE INVOICE ---
router.put('/:id', prepareInvoiceData, async (req, res) => {
  try {
    const { billing_records } = req.body;
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) return res.status(404).json({ message: 'Invoice not found' });

    if (billing_records && billing_records.length) {
      invoice.billing_records = billing_records;
    }

    await invoice.calculateTotals();
    await invoice.save();

    res.json(invoice);
  } catch (error) {
    res.status(500).json({ message: 'Failed to update invoice', error: error.message });
  }
});

module.exports = router;