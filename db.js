// db.js
const mongoose = require('mongoose');
require('dotenv').config();

const MONGO_URL = process.env.MONGO_URL;

const connectDB = () =>
    mongoose
      .connect(MONGO_URL)
      .then(() => console.log(`DB Connected Successfully....`))
      .catch((err) => {
        console.log('DB Connection Failed!');
        console.log(err);
        process.exit(1);
      });
  
module.exports = connectDB;
