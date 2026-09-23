const fs = require('fs');
const path = require('path');

const dbPath = path.resolve(__dirname, 'database.json');

// Initialize database file if it doesn't exist
const initDb = () => {
  if (!fs.existsSync(dbPath)) {
    const initialData = { users: [] };
    fs.writeFileSync(dbPath, JSON.stringify(initialData, null, 2), 'utf8');
    console.log('Created database.json persistent file storage.');
  }
};

initDb();

const readData = () => {
  try {
    const raw = fs.readFileSync(dbPath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Error reading database file:', err);
    return { users: [] };
  }
};

const writeData = (data) => {
  try {
    fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('Error writing database file:', err);
  }
};

// Database Promise Helpers
const dbGet = async (sql, params = []) => {
  const data = readData();
  const users = data.users || [];

  // Match by email
  if (sql.includes('email = ?')) {
    const targetEmail = params[0]?.toLowerCase();
    return users.find(u => u.email.toLowerCase() === targetEmail) || null;
  }

  // Match by id
  if (sql.includes('id = ?')) {
    const targetId = params[0];
    return users.find(u => u.id === targetId || u.id === Number(targetId)) || null;
  }

  return null;
};

const dbAll = async (sql, params = []) => {
  const data = readData();
  return data.users || [];
};

const dbRun = async (sql, params = []) => {
  const data = readData();
  
  if (sql.includes('INSERT INTO users')) {
    const [name, email, password] = params;
    const newUser = {
      id: Date.now(),
      name,
      email,
      password,
      role: 'user',
      created_at: new Date().toISOString()
    };
    
    data.users.push(newUser);
    writeData(data);

    return { id: newUser.id, changes: 1 };
  }

  return { id: null, changes: 0 };
};

module.exports = {
  dbGet,
  dbAll,
  dbRun
};
