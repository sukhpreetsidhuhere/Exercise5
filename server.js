// Load environment variables
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import path from 'path';
import { MongoClient, ObjectId } from 'mongodb';
import cookieParser from 'cookie-parser';
import logger from 'morgan';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Constants
const port = process.env.PORT || 3000;
const connectionString = process.env.ATLAS_URI || "";

// MongoDB connection setup
const client = new MongoClient(connectionString);
let db;

async function connectToDatabase() {
  try {
    await client.connect();
    db = client.db("sample_mflix");
    console.log("Connected to MongoDB");
  } catch (e) {
    console.error("Error connecting to MongoDB", e);
    process.exit(1); // Exit the process with an error code
  }
}

// Create Express app
const app = express();

// Middleware setup
app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// View engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'pug');

// Define routes
const router = express.Router();

router.get("/", async (req, res) => {
  try {
    let collection = db.collection("movies");
    let results = await collection.find({}).limit(10).toArray();
    res.status(200).send(results);
  } catch (e) {
    res.status(500).send({ error: e.message });
  }
});

router.get("/:id", async (req, res) => {
  try {
    let collection = db.collection("movies");
    let query = { _id: new ObjectId(req.params.id) };
    let result = await collection.findOne(query);
    if (!result) {
      res.status(404).send("Not found");
    } else {
      res.status(200).send(result);
    }
  } catch (e) {
    res.status(500).send({ error: e.message });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const query = { _id: new ObjectId(req.params.id) };
    const updates = {
      $set: { title: req.body.title }
    };
    let collection = db.collection("movies");
    let result = await collection.updateOne(query, updates);
    res.status(200).send(result);
  } catch (e) {
    res.status(500).send({ error: e.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const query = { _id: new ObjectId(req.params.id) };
    let collection = db.collection("movies");
    let result = await collection.deleteOne(query);
    res.status(200).send(result);
  } catch (e) {
    res.status(500).send({ error: e.message });
  }
});

app.use('/movies', router);

// Catch 404 and forward to error handler
app.use((req, res, next) => {
  const error = new Error("Not Found");
  error.status = 404;
  next(error);
});

// Error handler
app.use((err, req, res, next) => {
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  res.status(err.status || 500);
  res.render('error');
});

// Start server after connecting to MongoDB
connectToDatabase().then(() => {
  app.listen(port, () => {
    console.log(`Server started at http://localhost:${port}`);
  });
});
