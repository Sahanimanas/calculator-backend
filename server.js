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
mongoose.set('strictQuery', false);   // or true, both silence the warning

// const uri = "mongodb+srv://brain:Xeno%402025@myapp.global.mongocluster.cosmos.azure.com/?tls=true&authMechanism=SCRAM-SHA-256&retrywrites=false&maxIdleTimeMS=120000";

 async function connectDB() {
    try {
        await mongoose.connect(process.env.MONGODB_URI, {
            // These options ensure stability with Cosmos DB
            useNewUrlParser: true,
            useUnifiedTopology: true,
            retryWrites: false, 
        });
        console.log("Successfully connected to MongoDB");
    } catch (error) {
        console.error("Connection error:", error);
    }
}

connectDB()
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