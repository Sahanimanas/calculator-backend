const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json());
app.use(cors({ origin: '*' }));

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.log(err));  

// Routes
app.use('/api/auth', require('./routes/auth.route'));
app.use('/api/project', require('./routes/project.route'));

app.use('/api/upload-resource',require('./routes/resources-bulk-upload.route'))
app.use('/api/productivity', require('./routes/productivity.route'));
app.use('/api/level', require('./routes/subproject-level'));
app.use('/api/resource', require('./routes/Resource.route'));
app.use('/api/billing', require('./routes/billing.route'));
app.use('/api/invoices', require('./routes/Invoice.route'));
app.use('/api/calculator', require('./routes/calculator.route'));
app.use('/api/dashboard', require('./routes/dashboard.route'));
app.use('/api/masterdb', require('./routes/masterdb.route'));
app.use('/api/upload', require('./routes/bulkupload.route'));
// app.use('/api/auditlogs', require('./routes/auditlog.route'));
app.get('/', (req, res) => {
    res.send('API is running...');
});
app.listen(PORT,()=>{
    console.log(`Server is running on port ${PORT}`);
})