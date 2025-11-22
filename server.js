require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse JSON
app.use(express.json());

// IMPORTANT: Serve static files from 'public' folder FIRST
// This must come BEFORE the route handlers
app.use(express.static(path.join(__dirname, 'public')));

// API endpoint to get Supabase config (safe to expose)
app.get('/api/config', (req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY
  });
});

// Serve HTML files from src/Project
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'src', 'Project', 'login.html'));
});

app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, 'src', 'Project', 'register.html'));
});

app.get('/reset-password', (req, res) => {
  res.sendFile(path.join(__dirname, 'src', 'Project', 'resetPassword.html'));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'src', 'Project', 'dashboard.html'));
});

// Default route
app.get('/', (req, res) => {
  res.redirect('/login');
});

// 404 handler for debugging
app.use((req, res) => {
  console.log('❌ 404 - File not found:', req.url);
  res.status(404).send(`File not found: ${req.url}`);
});

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
  console.log(`📁 Serving static files from: ${path.join(__dirname, 'public')}`);
});