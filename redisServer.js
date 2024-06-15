import express from 'express';
import path from 'path';
import logger from 'morgan';
import cookieParser from 'cookie-parser';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import dotenv from 'dotenv';
import { MongoClient, ObjectId } from 'mongodb';
import redis from 'redis';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Constants
const port = process.env.PORT || 3000;
const connectionString = process.env.ATLAS_URI || "";

// MongoDB setup
const mongoClient = new MongoClient(connectionString);
let db;

// Redis setup
const redisClient = redis.createClient({
  host: 'localhost',
  port: 6379,
});

redisClient.on('error', (error) => {
  console.error(`Error connecting to Redis: ${error}`);
});

// Connect to MongoDB and Redis
async function connectToDatabase() {
  try {
    await mongoClient.connect();
    db = mongoClient.db("sample_mflix");
    console.log("Connected to MongoDB");
  } catch (e) {
    console.error("Error connecting to MongoDB", e);
    process.exit(1);
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

// Redis middleware to provide client instance to routes
app.use((req, res, next) => {
  req.redis = redisClient;
  next();
});

// Routes
const router = express.Router();

// Helper function to simplify movie object
function simplifyMovie(movie) {
  return {
    id: movie._id,
    name: movie.name,
    title: movie.title
  };
}

// GET all movies
router.get("/", async (req, res, next) => {
  try {
    redisClient.get('movies', async (err, cachedMovies) => {
      if (err) {
        console.error(`Error fetching movies from Redis: ${err}`);
        return next(err);
      }

      if (cachedMovies) {
        console.log('Fetching movies from Redis cache');
        res.json(JSON.parse(cachedMovies));
      } else {
        console.log('No movies found in Redis cache, fetching from MongoDB');
        let collection = db.collection("movies");
        let results = await collection.find({}).limit(10).toArray();
        let simplifiedResults = results.map(simplifyMovie);
        
        redisClient.set('movies', JSON.stringify(simplifiedResults), (err) => {
          if (err) {
            console.error(`Error caching movies in Redis: ${err}`);
          } else {
            console.log('Cached movies in Redis');
          }
        });

        res.status(200).json(simplifiedResults);
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET movie by ID
router.get("/:id", async (req, res, next) => {
  try {
    const movieId = req.params.id;
    redisClient.get(`movie:${movieId}`, async (err, cachedMovie) => {
      if (err) {
        console.error(`Error fetching movie from Redis: ${err}`);
        return next(err);
      }

      if (cachedMovie) {
        console.log('Fetching movie from Redis cache');
        res.json(JSON.parse(cachedMovie));
      } else {
        console.log('No movie found in Redis cache, fetching from MongoDB');
        let collection = db.collection("movies");
        let query = { _id: new ObjectId(movieId) };
        let result = await collection.findOne(query);
        if (!result) {
          res.status(404).send("Not found");
        } else {
          let simplifiedResult = simplifyMovie(result);
          
          redisClient.set(`movie:${movieId}`, JSON.stringify(simplifiedResult), (err) => {
            if (err) {
              console.error(`Error caching movie in Redis: ${err}`);
            } else {
              console.log('Cached movie in Redis');
            }
          });

          res.status(200).json(simplifiedResult);
        }
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH movie by ID
router.patch("/:id", async (req, res, next) => {
  try {
    const movieId = req.params.id;
    const query = { _id: new ObjectId(movieId) };
    const updates = {
      $set: { title: req.body.title }
    };
    let collection = db.collection("movies");
    let result = await collection.updateOne(query, updates);

    // Update cache after update (write-through)
    if (result.matchedCount > 0) {
      let updatedMovie = await collection.findOne(query);
      let simplifiedMovie = simplifyMovie(updatedMovie);

      redisClient.set(`movie:${movieId}`, JSON.stringify(simplifiedMovie), (err) => {
        if (err) {
          console.error(`Error updating movie in Redis: ${err}`);
        } else {
          console.log('Updated movie in Redis');
        }
      });

      redisClient.del('movies', (err) => {
        if (err) {
          console.error(`Error invalidating Redis cache: ${err}`);
        } else {
          console.log('Invalidated Redis cache after update');
        }
      });
    }

    res.status(200).json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE movie by ID
router.delete("/:id", async (req, res, next) => {
  try {
    const movieId = req.params.id;
    const query = { _id: new ObjectId(movieId) };
    let collection = db.collection("movies");
    let result = await collection.deleteOne(query);

    // Invalidate cache after delete
    redisClient.del(`movie:${movieId}`, (err) => {
      if (err) {
        console.error(`Error invalidating movie in Redis: ${err}`);
      } else {
        console.log('Invalidated movie in Redis after delete');
      }
    });

    redisClient.del('movies', (err) => {
      if (err) {
        console.error(`Error invalidating Redis cache: ${err}`);
      } else {
        console.log('Invalidated Redis cache after delete');
      }
    });

    res.status(200).json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
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

// Start server
connectToDatabase().then(() => {
  app.listen(port, () => {
    console.log(`Server started at http://localhost:${port}`);
  });
}).catch(err => {
  console.error('Error starting server:', err);
  process.exit(1);
});
