require("dotenv").config();

const express = require("express");
const api = express();

const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
//const cookieParser = require("cookie-parser");

api.use(express.json());
//api.use(cookieParser());
api.use((req, res, next) => {
    console.log("%s requested at %s", req.path, new Date());
    next();
});

const { MongoClient } = require("mongodb");
const client = new MongoClient(process.env.DB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
});

const authMiddleware = require("./middleware/auth");

// Auth endpoints

api.post("/v1/auth/login", async (req, res) => {
    if (!req.body.login || !req.body.password) return res.status(400).json({ status: "BAD_REQUEST" });

    let db = client.db("cablejs");
    let users = db.collection("users");

    let user = await users.findOne({ username: req.body.login });

    if (user)
    {
        console.log(req.body.password);
        console.log(user.password);
        bcrypt.compare(req.body.password, user.password, (err, ret) => {
            if (err) throw err;

            if (ret)
            {
                let token = jwt.sign({
                    uid: user.id,
                    signedAt: Date.now()
                }, process.env.JWT_SECRET);

                res.json({ status: "OK", token: token });
            }
            else
            {
                res.status(403).json({ status: "FORBIDDEN" });
            }
        });
    }
    else
    {
        res.status(400).json({ status: "BAD_REQUEST" });
    }
});

// Guild endpoints

api.post("/v1/guilds", authMiddleware, async (req, res) => {
    if (!req.body.name || typeof req.body.name != "string") return res.status(400).json({ status: "BAD_REQUEST" });

    let db = client.db("cablejs");
    let guilds = db.collection("guilds");

    let ret = await guilds.insertOne({
        gid: Math.floor(Math.random() * (Math.floor(100000) - Math.ceil(1) + 1)) + 1,
        name: req.body.name,
        description: "",
        verified: false,
        partnered: false,
        members: [
            {
                user: req.cableAuth.uid,
                nick: null,
                owner: true,
                joinedAt: new Date()
            }
        ]
    });

    console.log(ret);
    res.status(201).json({ status: "CREATED" });
});

api.get("/v1/guilds/:id", authMiddleware, async (req, res) => {
    let gid = req.params.id;
    let withCounts = req.query.withCounts === "true";

    let db = client.db("cablejs");
    let guilds = db.collection("guilds");

    let guild = await guilds.findOne({ gid: parseInt(gid) });

    delete guild._id;
    delete guild.members;

    res.json(guild);
});

api.get("/v1/guilds/:id/members", authMiddleware, async (req, res) => {
    let gid = req.params.id;

    let db = client.db("cablejs");

    let users = db.collection("users");
    let guilds = db.collection("guilds");

    let guild = await guilds.findOne({ gid: parseInt(gid) });

    for (i = 0; i < guild.members.length; i++)
    {
        let guildMemberObj = guild.members[i];
        let realGuildMember = await users.findOne({ id: guildMemberObj.user });
        delete realGuildMember.password;
        guildMemberObj.user = realGuildMember;
    }

    res.json(guild.members);
});

api.get("/v1/guilds/:gid/members/:uid", authMiddleware, async (req, res) => {
    let gid = req.params.gid;
    let uid = req.params.uid;

    let db = client.db("cablejs");

    let users = db.collection("users");
    let guilds = db.collection("guilds");

    let guild = await guilds.findOne({ gid: parseInt(gid) });

    let guildMember = guild.members.find(guildMemberObj => guildMemberObj.user === parseInt(uid));
    if (guildMember === undefined) return res.status(404).json({ status: "NOT_FOUND", message: "User was not found in guild" });
    
    res.json(guildMember);
});

api.get("/v1/guilds/:id/channels", authMiddleware, async (req, res) => {
    let gid = req.params.id;

    let db = client.db("cablejs");

    let guilds = db.collection("guilds");
    let channels = db.collection("channels");

    let guild = await guilds.findOne({ gid: parseInt(gid) });

    if (guild)
    {
        let guildChannels = await channels.find({ gid: parseInt(gid) }).toArray();
        res.json(guildChannels);
    }
    else
    {
        return res.status(404).json({ status: "NOT_FOUND", message: "Guild non-existant" });
    }
});

// Channel endpoints

api.get("/v1/channels/:id", authMiddleware, async (req, res) => {
    let cid = req.params.id;

    let db = client.db("cablejs");

    let guilds = db.collection("guilds");
    let channels = db.collection("channels");

    let channel = await channels.findOne({ id: parseInt(cid) });
    let guild = await guilds.findOne({ gid: channel.gid });

    let userInGuild = guild.members.find(guildMember => guildMember.user === req.cableAuth.uid);

    if (userInGuild === undefined) return res.status(403).json({ status: "FORBIDDEN", message: "Missing access" });

    delete channel._id;
    delete channel.messages;

    res.json(channel);
});

api.get("/v1/channels/:id/messages", authMiddleware, async (req, res) => {
    let cid = req.params.id;

    let db = client.db("cablejs");

    let users = db.collection("users");
    let channels = db.collection("channels");

    let channel = await channels.findOne({ id: parseInt(cid) });

    for (i = 0; i < channel.messages.length; i++)
    {
        let messageObj = channel.messages[i];
        let realAuthor = await users.findOne({ id: messageObj.author });
        delete realAuthor.password;
        messageObj.author = realAuthor;
    }

    res.json(channel.messages);
});

api.post("/v1/channels/:id/messages", authMiddleware, async (req, res) => {
    let cid = req.params.id;
    let body = req.body;

    let db = client.db("cablejs");
    let channels = db.collection("channels");

    // Use the $push operator to push a new message object into the array
    let ret = await channels.findOneAndUpdate({ id: parseInt(cid) }, {
        $push: {
            messages: {
                id: Math.floor(Math.random() * (Math.floor(100000) - Math.ceil(1) + 1)) + 1,
                author: req.cableAuth.uid,
                content: body.content
            }
        }
    });

    console.log(ret);
    res.status(201).json({ status: "CREATED" });
});

api.get("/v1/channels/:cid/messages/:mid", authMiddleware, async (req, res) => {
    let cid = req.params.cid;
    let mid = req.params.mid;

    let db = client.db("cablejs");
    let channels = db.collection("channels");

    let channel = await channels.findOne({ id: parseInt(cid) });

    let message = channel.messages.find(messageObj => messageObj.id === parseInt(mid));
    if (message === undefined) return res.status(404).json({ status: "NOT_FOUND", message: "Message not found in specified channel" });

    res.json(message);
});

api.patch("/v1/channels/:cid/messages/:mid", authMiddleware, async (req, res) => {
    let cid = req.params.cid;
    let mid = req.params.mid;

    let db = client.db("cablejs");
    let channels = db.collection("channels");
});

api.delete("/v1/channels/:cid/messages/:mid", authMiddleware, async (req, res) => {
    let cid = req.params.cid;
    let mid = req.params.mid;

    let db = client.db("cablejs");
    let channels = db.collection("channels");

    // let channel = await channels.findOne({ id: parseInt(cid) });

    // let message = channel.messages.find(messageObj => messageObj.id === parseInt(mid));
    // if (message === undefined) return res.status(404).json({ status: "NOT_FOUND", message: "Message not found in specified channel" });

    let ret = await channels.findOneAndUpdate({ id: parseInt(cid) }, {
        $pull: {
            messages: {
                id: parseInt(mid)
            }
        }
    });

    console.log(ret);
    res.status(204).end();
});

// User endpoints
//
// {
//    id,
//    username,
//    password,
//    discriminator,
//    bot,
//    staff,
//    disabled,
//    joinedAt
// }

api.get("/v1/users/@me", authMiddleware, async (req, res) => {
    let db = client.db("cablejs");
    let users = db.collection("users");

    let user = await users.findOne({ id: req.cableAuth.uid });
    delete user.password;

    res.json(user);
});

api.get("/v1/users/@me/guilds", authMiddleware, async (req, res) => {
    let db = client.db("cablejs");
    let users = db.collection("users");

    let user = await users.findOne({ id: req.cableAuth.uid });
    
    res.json(user.guilds);
});

api.get("/v1/users/:id", authMiddleware, async (req, res) => {
    let uid = req.params.id;

    let db = client.db("cablejs");
    let users = db.collection("users");

    let user = await users.findOne({ id: parseInt(uid) });
    delete user.password;

    res.json(user);    
});

api.get("/v1/users/:id/profile", authMiddleware, async (req, res) => {
    let uid = req.params.id;

    let db = client.db("cablejs");
    let users = db.collection("users");

    let user = await users.findOne({ id: parseInt(uid) });

    res.json({
        mutual_guilds: null,
        premium_since: null,
        user: user
    });
});

// ----------------------------------------------------------------------

api.listen(80, () => {
    console.log("Ready");
    try
    {
        client.connect((err, ret) => {
            if (err) throw err;
        });
    }
    catch (e) {}
});