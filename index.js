const express = require("express");
const app = express();
require("dotenv").config();
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const jwt = require("jsonwebtoken");
const morgan = require("morgan");
const stripe = require("stripe")(process.env.STRIPE_SECRET);
const port = process.env.PORT || 5000;

// middleware
const corsOptions = {
    origin: [
        "http://localhost:5173",
        "http://localhost:5174",
        "https://assignment-12-contest-hub.web.app",
        "https://assignment-12-contest-hub.firebaseapp.com",
    ],
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
        const registrationCollection = client
            .db("ContestHubDB")
            .collection("Registrations");

        //admin verification
        const verifyAdmin = async (req, res, next) => {
            const user = req.user;
            const query = { email: user?.email };
            const result = await usersCollection.findOne(query);

            if (!result || result?.role !== "admin") {
                return res.status(403).send({ message: "forbidden" });
            }
            next();
        };

        //creator verification
        const verifyCreator = async (req, res, next) => {
            const user = req.user;
            const query = { email: user?.email };
            const result = await usersCollection.findOne(query);

            if (!result || result?.role !== "creator") {
                return res.status(403).send({ message: "forbidden" });
            }
            next();
        };

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

        //getting all approved contests
        app.get("/contests", async (req, res) => {
            const category = req.query.category;
            let query = { status: "approved" };

            if (category) {
                query.category = category;
            }

            const cursor = contestCollection.find(query);
            const result = await cursor.toArray();

            res.send(result);
        });

        //getting all contests for dev
        app.get("/all_contests", async (req, res) => {
            const cursor = contestCollection.find();
            const result = await cursor.toArray();

            res.send(result);
        });

        //getting top contests for home page
        app.get("/top_contests", async (req, res) => {
            const query = { status: "approved" };
            const cursor = contestCollection.find(query).sort({ attemptedCount: -1 });
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

        //updating user role
        app.put("/users/update/:email", verifyToken, async (req, res) => {
            const email = req.params.email;
            const user = req.body;
            const query = { email: email };
            const options = { upsert: true };

            const updateDoc = {
                $set: {
                    ...user,
                    timestamp: Date.now(),
                },
            };

            const result = await usersCollection.updateOne(query, updateDoc, options);
            res.send(result);
        });

        //posting new contest
        app.post("/contests", async (req, res) => {
            const contest = req.body;
            console.log(contest);

            const result = await contestCollection.insertOne(contest);
            res.send(result);
        });

        //getting single user's data
        app.get("/user/:email", async (req, res) => {
            const email = req.params.email;
            const query = { email: email };

            const result = await usersCollection.findOne(query);
            res.send(result);
        });

        //getting all users for admin
        app.get("/users", async (req, res) => {
            const cursor = usersCollection.find();
            const result = await cursor.toArray();

            res.send(result);
        });

        //get specific creator's contest
        app.get("/contests/:email", async (req, res) => {
            const email = req.params.email;
            const query = { "creatorInfo.email": email };

            const result = await contestCollection.find(query).toArray();
            res.send(result);
        });

        //generate client secret for client payment
        app.post("/create_payment_intent", verifyToken, async (req, res) => {
            const { price } = req.body;
            const amount = parseInt(price * 100);

            if (!price || amount < 1) {
                return;
            }

            const { client_secret } = await stripe.paymentIntents.create({
                amount: amount,
                currency: "usd",
                payment_method_types: ["card"],
            });

            res.send({ clientSecret: client_secret });
        });

        //saving registration info
        app.post("/registrations", verifyToken, async (req, res) => {
            const { _id, ...registration } = req.body;
            const result = await registrationCollection.insertOne(registration);

            res.send(result);
        });

        //updating contest status
        app.patch("/update_contest_status/:id", async (req, res) => {
            const id = req.params.id;
            const status = req.body.status;
            console.log(status);
            const query = { _id: new ObjectId(id) };
            const update = { $set: { status: status } };
            const options = { upsert: true };

            const result = await contestCollection.updateOne(query, update, options);
            res.send(result);
        });

        //deleting contest
        app.delete("/delete_contest/:id", async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };

            const result = await contestCollection.deleteOne(query);
            res.send(result);
        });

        //saving participant data
        app.patch("/save_participant_info/:id", async (req, res) => {
            const id = req.params.id;
            const participantInfo = req.body;

            const query = { _id: new ObjectId(id) };
            const update = {
                $push: {
                    participants: participantInfo,
                },
                $inc: {
                    attemptedCount: 1,
                },
            };

            const result = await contestCollection.updateOne(query, update);
            res.send(result);
        });

        //updating contest
        app.patch("/update_contest/:id", async (req, res) => {
            const id = req.params.id;
            const contest = req.body;
            const query = { _id: new ObjectId(id) };

            const options = { upsert: true };
            const update = {
                $set: {
                    name: contest.name,
                    price: contest.price,
                    image: contest.image,
                    prizeMoney: contest.prizeMoney,
                    category: contest.category,
                    deadline: contest.deadline,
                    taskSubmissionText: contest.taskSubmissionText,
                    description: contest.description,
                },
            };

            const result = await contestCollection.updateOne(query, update, options);
            res.send(result);
        });

        //getting user specific participated data
        app.get("/my_participated_contests/:email", async (req, res) => {
            const email = req.params.email;
            const query = {
                participants: {
                    $elemMatch: {
                        email: email,
                    },
                },
            };

            const result = await contestCollection.find(query).toArray();
            res.send(result);
        });

        //getting user specific winning data
        app.get("/my_winning_contests/:email", async (req, res) => {
            const email = req.params.email;
            const query = { "winnerInfo.email": email };

            const result = await contestCollection.find(query).toArray();
            res.send(result);
        });

        //making a participant winner
        app.patch("/declare_winner/:id", async (req, res) => {
            const id = req.params.id;
            const participant = req.body;

            const query = { _id: new ObjectId(id) };
            const update = {
                $set: {
                    winnerInfo: participant,
                },
            };
            const options = { upsert: true };

            const result = await contestCollection.updateOne(query, update, options);
            res.send(result);
        });

        // Search contests by category
        app.get("/search_contests/:category", async (req, res) => {
            const category = req.params.category;
            const query = {
                status: "approved",
                category: { $regex: new RegExp(category, "i") },
            };

            const cursor = contestCollection.find(query);
            const result = await cursor.toArray();
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
