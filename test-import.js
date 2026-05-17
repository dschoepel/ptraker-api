require('dotenv').config();
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const http = require('http');

const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI1NzUxOTMyNi05N2VhLTQyNjgtYTkxYy1lN2VhZmI2NGFkM2YiLCJhdWQiOiJhdXRoZW50aWNhdGVkIiwiZXhwIjoxNzc5MDU0NzU2LCJpYXQiOjE3NzkwNTExNTYsImVtYWlsIjoiZGF2ZUB0aGVzY2hvZXBlbHMuY29tIiwicGhvbmUiOiIiLCJhcHBfbWV0YWRhdGEiOnsicHJvdmlkZXIiOiJlbWFpbCIsInByb3ZpZGVycyI6WyJlbWFpbCJdfSwidXNlcl9tZXRhZGF0YSI6eyJlbWFpbF92ZXJpZmllZCI6dHJ1ZX0sInJvbGUiOiJhdXRoZW50aWNhdGVkIiwiYWFsIjoiYWFsMSIsImFtciI6W3sibWV0aG9kIjoicGFzc3dvcmQiLCJ0aW1lc3RhbXAiOjE3NzkwNTExNTZ9XSwic2Vzc2lvbl9pZCI6IjIwZjQ5YjRhLTlhYWYtNDg4NS05MmQwLWU1YWFkYjM3ZDA0OSIsImlzX2Fub255bW91cyI6ZmFsc2V9.xtB8YRLwHdhZrhVkm1q1DLayxWBJEMJfXJISfzYZobg';
const FILE_PATH = 'C:\\Users\\dscho\\Downloads\\Positions.csv';

async function testImport() {
  const form = new FormData();
  form.append('importerId', 'lpl_csv');
  form.append('file', fs.createReadStream(FILE_PATH), {
    filename: 'Positions.csv',
    contentType: 'text/csv',
  });

  const options = {
    hostname: 'localhost',
    port: 5000,
    path: '/api/v1/import/upload',
    method: 'POST',
    headers: {
      ...form.getHeaders(),
      Authorization: `Bearer ${TOKEN}`,
    },
  };

  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log(JSON.stringify(JSON.parse(data), null, 2));
        resolve();
      });
    });
    req.on('error', reject);
    form.pipe(req);
  });
}

testImport().catch(console.error);