const express = require("express");
const { Pool } = require("pg");
const dotenv = require("dotenv");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const cors = require("cors");

const app = express();

// Enable CORS for cross-origin requests
app.use(
  cors({
    origin: "https://task-master-frontend-two.vercel.app", // Allow requests from frontend
    allowedHeaders: ["Authorization", "Content-Type"], // Allow these headers
    methods: ["GET", "POST", "PUT", "DELETE"], // Allow these methods
    credentials: true, // Allow cookies or Authorization headers
  })
);

app.use(express.json()); // Parse JSON payloads
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded payloads
app.options("*", cors()); // Allow all preflight requests
app.use((req, res, next) => {
  res.header(
    "Access-Control-Allow-Origin",
    "https://task-master-frontend-two.vercel.app"
  );
  res.header("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE");
  next();
});

dotenv.config();

// Use the PORT environment variable or default to 3000 for local development
const PORT = process.env.PORT || 3000;

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

// Connection On Render

const pool = new Pool({
  connectionString: process.env.DATABASE_URL, // Fetch from environment variables
  ssl: {
    rejectUnauthorized: false, // Required for Render-managed databases
  },
});

module.exports = pool; // Export the pool for use in your app

app.use(express.json());

// Initialize the database
const initializeDatabase = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        id SERIAL PRIMARY KEY,
        user_id INT REFERENCES users(id),
        title VARCHAR(255) NOT NULL,
        description TEXT,
        status VARCHAR(50),
        priority VARCHAR(50),
        deadline TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log("Database tables initialized successfully.");
  } catch (error) {
    console.error("Error initializing database:", error);
  }
};

// Call the database initialization function
initializeDatabase();

// Routes
app.get("/", (req, res) => {
  res.send("Welcome to the Task Manager API!");
});

// Route for testing database connection
app.get("/test-db", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW() AS current_time");
    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error("Database test error:", error);
    res.status(500).send("Database connection failed.");
  }
});

app.get("/", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.send(
      `Welcome to my Simple Taskmaster. The Database has connected successfully: ${result.rows[0].now}`
    );
  } catch (err) {
    console.error(err);
    res.status(500).send("Database connection failed");
  }
});

// Create New User
app.post("/register", async (req, res) => {
  const { username, email, password } = req.body;

  // Log the entire request body for debugging
  console.log("Request body:", req.body);

  if (!username || !email || !password || typeof password !== "string") {
    return res.status(400).send("All fields are required").json({
      message: "Invalid input. Ensure all fields are filled correctly.",
    });
  }

  try {
    // Hash the password
    const saltRounds = 10;

    const hashedPassword = await bcrypt.hash(password, saltRounds);
    console.log("Password before hashing:", password); // Should log the correct value

    // Insert the user into the database
    const result = await pool.query(
      "INSERT INTO users (username, email, password) VALUES ($1, $2, $3) RETURNING id",
      [username, email, hashedPassword]
    );

    res.status(201).send(`User registered with ID: ${result.rows[0].id}`);
  } catch (err) {
    console.error(err);
    if (err.code === "23505") {
      // Unique constraint violation
      res.status(409).send("Username or email already exists");
    } else {
      console.error("Error registering user:", error);
      res.status(500).send("Internal server error");
    }
  }
});

/* User Login  */
app.post("/login", async (req, res) => {
  const { emailOrUsername, password } = req.body;

  if (!emailOrUsername || !password) {
    return res.status(400).send("Email/Username and password are required");
  }

  try {
    // Check if the user exists by email OR username
    const userResult = await pool.query(
      "SELECT * FROM users WHERE email = $1 OR username = $1",
      [emailOrUsername]
    );

    if (userResult.rowCount === 0) {
      return res.status(404).send("User not found");
    }

    const user = userResult.rows[0];

    // Compare passwords
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return res.status(401).send("Invalid password");
    }

    // Generate a JWT
    const token = jwt.sign(
      { id: user.id, username: user.username },
      process.env.JWT_SECRET || "your_jwt_secret",
      { expiresIn: "1h" }
    );

    res.status(200).send({ message: "Login successful", token });
  } catch (err) {
    console.error(err);
    res.status(500).send("Internal server error");
  }
});

/* Create a Task */
//Create a Route to Add a New Task:
const authenticateToken = (req, res, next) => {
  console.log("Request Headers:", req.headers);

  const token = req.headers["authorization"]?.split(" ")[1];
  console.log("Received token:", token);

  if (!token) return res.status(401).send("Access token required");

  jwt.verify(
    token,
    process.env.JWT_SECRET || "your_jwt_secret",
    (err, user) => {
      if (err) {
        console.error("Token verification error:", err.message);
        return res.status(403).send("Invalid token");
      }
      console.log("Verified user:", user);
      req.user = user;
      next();
    }
  );
};

// Create Tasks
app.post("/tasks", authenticateToken, async (req, res) => {
  const { title, description, status, priority, deadline } = req.body;

  if (!title || !priority) {
    return res.status(400).send("Title and priority are required");
  }

  const validPriorities = ["low", "medium", "high"];
  const validStatuses = ["pending", "in-progress", "completed"];

  if (!validPriorities.includes(priority)) {
    return res.status(400).send("Invalid priority");
  }
  if (status && !validStatuses.includes(status)) {
    return res.status(400).send("Invalid status");
  }

  try {
    const result = await pool.query(
      `INSERT INTO tasks (user_id, title, description, status, priority, deadline) 
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.user.id, title, description, status, priority, deadline]
    );
    res.status(201).send(result.rows[0]);
  } catch (err) {
    console.error("Database error:", err);
    res.status(500).send("Failed to create task");
  }
});

/* Retrieve All Tasks for a User  */
app.get("/tasks", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM tasks WHERE user_id = $1 ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.status(200).send(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send("Failed to fetch tasks");
  }
});

/* Update a Task */
// Route to Update Tasks
app.put("/tasks/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { title, description, status, priority, deadline } = req.body;

  if (!title && !description && !status && !priority && !deadline) {
    return res
      .status(400)
      .send("At least one field must be provided to update");
  }

  try {
    const result = await pool.query(
      `UPDATE tasks
       SET title = COALESCE($1, title),
           description = COALESCE($2, description),
           status = COALESCE($3, status),
           priority = COALESCE($4, priority),
           deadline = COALESCE($5, deadline)
       WHERE id = $6 AND user_id = $7
       RETURNING *`,
      [title, description, status, priority, deadline, id, req.user.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).send("Task not found or not authorized to update");
    }

    res.status(200).send(result.rows[0]);
  } catch (err) {
    console.error("Error updating task:", err);
    res.status(500).send("Failed to update task");
  }
});

/* Delete a Task */
//  Route to Delete Tasks
app.delete("/tasks/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `DELETE FROM tasks WHERE id = $1 AND user_id = $2 RETURNING *`,
      [id, req.user.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).send("Task not found or not authorized to delete");
    }

    res.status(200).send("Task deleted successfully");
  } catch (err) {
    console.error("Error deleting task:", err);
    res.status(500).send("Failed to delete task");
  }
});

/* Task Filtering */
// Route for Filtering Tasks
app.get("/tasks/filter", authenticateToken, async (req, res) => {
  const { status, priority, due_date } = req.query;

  // Validate due_date format if it's provided
  if (due_date && isNaN(Date.parse(due_date))) {
    return res
      .status(400)
      .json({ message: "Invalid date format for 'due_date'" });
  }

  try {
    // SQL query to filter tasks based on status, priority, and due_date
    const query = `
      SELECT * FROM tasks
      WHERE user_id = $1
        AND ($2::TEXT IS NULL OR status = $2)
        AND ($3::TEXT IS NULL OR priority = $3)
        AND ($4::TIMESTAMP IS NULL OR deadline <= $4)
      ORDER BY created_at DESC
    `;

    // Execute the query with parameters, checking for valid status and priority
    const result = await pool.query(query, [
      req.user.id,
      status || null, // Use null if status is not provided
      priority || null, // Use null if priority is not provided
      due_date ? new Date(due_date) : null, // Use the date if provided
    ]);

    // Send the filtered tasks
    res.status(200).json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to filter tasks" });
  }
});

/* Search Functionality */
//Route for Searching Tasks
app.get("/tasks/search", authenticateToken, async (req, res) => {
  const { keyword } = req.query;

  if (!keyword) {
    return res.status(400).send("Keyword is required for searching");
  }

  try {
    const query = `
      SELECT * FROM tasks
      WHERE user_id = $1
        AND (title ILIKE $2 OR description ILIKE $2)
      ORDER BY deadline DESC
    `;
    const result = await pool.query(query, [req.user.id, `%${keyword}%`]);
    res.status(200).send(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send("Failed to search tasks");
  }
});

/* {
  "username": "Witty Umosung",
  "email": "pukkawit.study@gmail.com",
  "password": "securepassword123"
} */

app.get("/tasks/filter", authenticateToken, async (req, res) => {
  const { status, priority, due_date } = req.query;

  // Validate due_date format if it's provided
  if (due_date && isNaN(Date.parse(due_date))) {
    return res
      .status(400)
      .json({ message: "Invalid date format for 'due_date'" });
  }

  try {
    // SQL query to filter tasks based on status, priority, and due_date
    const query = `
      SELECT * FROM tasks
      WHERE user_id = $1
        AND ($2::TEXT IS NULL OR status = $2)
        AND ($3::TEXT IS NULL OR priority = $3)
        AND ($4::TIMESTAMP IS NULL OR deadline <= $4)
      ORDER BY created_at DESC
    `;

    // Execute the query with parameters, checking for valid status and priority
    const result = await pool.query(query, [
      req.user.id,
      status || null, // Use null if status is not provided
      priority || null, // Use null if priority is not provided
      due_date ? new Date(due_date) : null, // Use the date if provided
    ]);

    // Send the filtered tasks
    res.status(200).json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to filter tasks" });
  }
});
