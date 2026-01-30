// services/emailService.js - Email service for sending OTP via Microsoft 365
const nodemailer = require('nodemailer');

// Create transporter using your .env variables
const createTransporter = () => {
  try {
    return nodemailer.createTransport({
      host: process.env.SMTP_SERVER,           // smtp.office365.com
      port: parseInt(process.env.SMTP_PORT),   // 587
      secure: false,                           // false for TLS/STARTTLS
      auth: {
        user: process.env.EMAIL_USER,          // Notif@valerionhealth.in
        pass: process.env.EMAIL_PASS           // Your password
      },
      tls: {
        ciphers: 'SSLv3',
        rejectUnauthorized: false
      },
      requireTLS: true
    });
  } catch (error) {
    console.error('Error creating email transporter:', error);
    throw error;
  }
};

// Send OTP email
const sendOTPEmail = async (email, otp, resourceName) => {
  try {
    const transporter = createTransporter();
    
    const mailOptions = {
      from: `"Billing System" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Your Login OTP - Billing System',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); color: white; padding: 30px 20px; text-align: center; border-radius: 12px 12px 0 0; }
            .content { background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; }
            .otp-box { background: #f0f9ff; border: 2px dashed #2563eb; padding: 25px; text-align: center; margin: 25px 0; border-radius: 12px; }
            .otp-code { font-size: 26px; font-weight: bold; color: #1d4ed8; letter-spacing: 10px; font-family: monospace; }
            .timer { display: inline-block; background: #fef3c7; color: #92400e; padding: 8px 16px; border-radius: 20px; font-size: 13px; margin-top: 15px; }
            .footer { background: #f8fafc; padding: 20px; text-align: center; font-size: 12px; color: #64748b; border-radius: 0 0 12px 12px; }
            .warning { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin-top: 20px; font-size: 13px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header"><h1>🔐 Login Verification</h1></div>
            <div class="content">
              <p>Hello <strong>${resourceName || 'User'}</strong>,</p>
              <p>Use the OTP below to complete your login:</p>
              <div class="otp-box">
                <div class="otp-code">${otp}</div>
                <p style="margin: 10px 0 0 0; color: #6b7280;">Enter this code to login</p>
                <div class="timer">⏱️ Valid for 10 minutes</div>
              </div>
              <div class="warning">⚠️ <strong>Security:</strong> Never share this OTP with anyone.</div>
            </div>
            <div class="footer">
              <p>Billing System - Valerion Health</p>
              <p>If you didn't request this, please ignore this email.</p>
            </div>
          </div>
        </body>
        </html>
      `,
      text: `Hello ${resourceName || 'User'},\n\nYour OTP is: ${otp}\n\nValid for 10 minutes.\n\n- Billing System`
    };
    
    const info = await transporter.sendMail(mailOptions);
    console.log('✅ OTP email sent to:', email);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('❌ Error sending OTP email:', error.message);
    return { success: false, error: error.message };
  }
};

// Development mode - log OTP to console
const sendOTPEmailDevelopment = async (email, otp, resourceName) => {
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║        📧 OTP (Development Mode)             ║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log(`║  To:   ${email.padEnd(38)}║`);
  console.log(`║  Name: ${(resourceName || 'User').padEnd(38)}║`);
  console.log(`║  OTP:  ${otp}                                 ║`);
  console.log('╚══════════════════════════════════════════════╝\n');
  return { success: true, messageId: 'dev-mode' };
};

// Send welcome email
const sendWelcomeEmail = async (email, resourceName) => {
  try {
    const transporter = createTransporter();
    const mailOptions = {
      from: `"Billing System" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Welcome to Billing System',
      html: `<h2>Welcome ${resourceName}!</h2><p>Your account has been created. Login with your email using OTP.</p>`
    };
    await transporter.sendMail(mailOptions);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

// Test configuration
const testEmailConfiguration = async () => {
  try {
    console.log('Testing email config...');
    console.log('SMTP:', process.env.SMTP_SERVER, ':', process.env.SMTP_PORT);
    console.log('User:', process.env.EMAIL_USER);
    const transporter = createTransporter();
    await transporter.verify();
    console.log('✅ Email configuration OK!');
    return { success: true };
  } catch (error) {
    console.error('❌ Email config failed:', error.message);
    return { success: false, error: error.message };
  }
};

module.exports = {
  sendOTPEmail,
  sendOTPEmailDevelopment,
  sendWelcomeEmail,
  testEmailConfiguration
};