const mongoose = require('mongoose');
const dotenv = require('dotenv');
const app = require('./app');
dotenv.config();

console.log(`NODE_ENV: ${process.env.NODE_ENV}`);


process.on('uncaughtException', (err) => {
  console.log('Uncaught Exception ☹️');
  console.error(err.name, err.message);
  process.exit(1);
});


mongoose.connect(process.env.MONGODB_URI)
.then(() => {
  console.log('✅ Connected to database');
})

.catch(err => {
  console.error('Error connecting to MongoDB:', err.message);
  process.exit(1);
});


const PORT = process.env.PORT || 3003; 
const server = app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});


process.on('unhandledRejection', (err) => {
  console.log('Unhandled Rejection ☹️');
  console.error(err.name, err.message);
  server.close(() => {
    process.exit(1);
  });
});
