const express = require("express");
const app = express();
require("dotenv").config();
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const jwt = require("jsonwebtoken");
const morgan = require("morgan");
const port = process.env.PORT || 5000;

// middleware
const corsOptions = {
    origin: ["http://localhost:5173", "http://localhost:5174"],
    credentials: true,
    optionSuccessStatus: 200,
};
app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());
app.use(morgan("dev"));

const verifyToken = async (req, res, next) => {
    const token = req.cookies?.token;
    console.log(token);
    if (!token) {
        return res.status(401).send({ message: "unauthorized access" });
    }
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
            console.log(err);
            return res.status(401).send({ message: "unauthorized access" });
        }
        req.user = decoded;
        next();
    });
};

const client = new MongoClient(process.env.DB_URI, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    },
});
async function run() {
    try {
        const contestCollection = client.db("ContestHubDB").collection("Contests");
        const usersCollection = client.db("ContestHubDB").collection("Users");

        // auth related api
        app.post("/jwt", async (req, res) => {
            const user = req.body;
            console.log("I need a new jwt", user);
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
                expiresIn: "365d",
            });
            res.cookie("token", token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === "production",
                sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
            }).send({ success: true });
        });

        // Logout
        app.get("/logout", async (req, res) => {
            try {
                res.clearCookie("token", {
                    maxAge: 0,
                    secure: process.env.NODE_ENV === "production",
                    sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
                }).send({ success: true });
                console.log("Logout successful");
            } catch (err) {
                res.status(500).send(err);
            }
        });

        // Save or modify user email, status in DB
        app.put("/users/:email", async (req, res) => {
            const email = req.params.email;
            const user = req.body;
            const query = { email: email };
            const options = { upsert: true };
            const isExist = await usersCollection.findOne(query);
            console.log("User found?----->", isExist);
            if (isExist) return res.send(isExist);
            const result = await usersCollection.updateOne(
                query,
                {
                    $set: { ...user, timestamp: Date.now() },
                },
                options
            );
            res.send(result);
        });

        //getting all contests
        app.get("/contests", async (req, res) => {
            const category = req.query.category;
            let query = {};

            if (category) {
                query.category = category;
            }

            const cursor = contestCollection.find(query);
            const result = await cursor.toArray();

            res.send(result);
        });

        //getting top contests for home page
        app.get("/top_contests", async (req, res) => {
            const cursor = contestCollection.find().sort({ attemptedCount: -1 });
            const foundContests = await cursor.limit(5).toArray();

            res.send(foundContests);
        });

        //getting single contest data
        app.get("/contest/:id", async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };

            const contest = await contestCollection.findOne(query);
            res.send(contest);
        });

        //posting new contest
        app.post("/contests", async (req, res) => {
            const contest = req.body;
            console.log(contest);

            const result = await contestCollection.insertOne(contest);
            res.send(result);
        });

        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);

app.get("/", (req, res) => {
    res.send("Hello from contest hub Server..");
});

app.listen(port, () => {
    console.log(`contest hub is running on port ${port}`);
});
