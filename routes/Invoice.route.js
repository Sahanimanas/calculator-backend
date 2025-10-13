// routes/invoice.js
const express = require('express');
const router = express.Router();
const Invoice = require('../models/Invoices');
const Billing = require('../models/Billing');

// --- CREATE INVOICE ---
router.post('/', async (req, res) => {
    try {
        const {  billing_records } = req.body;

        if (!billing_records || !billing_records.length) {
            return res.status(400).json({ message: 'Invoice number and billing records are required.' });
        }

        // Create invoice
        const invoice = new Invoice({ billing_records });
        await invoice.calculateTotals(); // populate totals
        await invoice.save();

        res.status(201).json(invoice);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to create invoice', error: error.message });
    }
});

// --- GET ALL INVOICES ---
router.get('/', async (req, res) => {
    try {
        const invoices = await Invoice.find().populate('billing_records').sort({ createdAt: -1 });
        res.json(invoices);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to fetch invoices' });
    }
});

// --- GET SINGLE INVOICE ---
router.get('/:id', async (req, res) => {
    try {
        const invoice = await Invoice.findById(req.params.id).populate('billing_records');
        if (!invoice) return res.status(404).json({ message: 'Invoice not found' });
        res.json(invoice);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to fetch invoice' });
    }
});

// --- DELETE INVOICE (optional) ---
router.delete('/:id', async (req, res) => {
    try {
        const invoice = await Invoice.findById(req.params.id);
        if (!invoice) return res.status(404).json({ message: 'Invoice not found' });

        // Optional: only allow deleting if you want to allow it
        await invoice.remove();
        res.json({ message: 'Invoice deleted successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to delete invoice' });
    }
});

// --- Prevent UPDATE / PATCH ---
router.put('/:id', (req, res) => {
    return res.status(403).json({ message: 'Invoices cannot be modified once generated.' });
});
router.patch('/:id', (req, res) => {
    return res.status(403).json({ message: 'Invoices cannot be modified once generated.' });
});

module.exports = router;
