// Copyright (c) 2021 EmeraldSys Media Ltd, All Rights Reserved

require("dotenv").config();

const express = require("express");
const api = express();
const cors = require("./middleware/cors");

api.use(express.json());
const textMiddleware = require("plaintextparser");
api.use((req, res, next) => {
    console.log("%s requested at %s", req.path, new Date());
    next();
});
api.use(cors);

const { MongoClient } = require("mongodb");
const client = new MongoClient(process.env.DB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
});

const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const authMiddleware = require("./middleware/auth");

process.stdin.setEncoding('utf8');

function readlineSync() {
    return new Promise((resolve, reject) => {
        process.stdin.resume();
        process.stdin.on('data', function (data) {
            process.stdin.pause();
            resolve(data);
        });
    });
}

// Remove this if you are deploying somewhere else other than Repl.it
api.post("/refresh", textMiddleware, async (req, res) => {
    console.log("repl.deploy" + req.text + req.get("Signature"));

    let line = await readlineSync();
    console.log(line);

    let ret = JSON.parse(line);

    await res.status(ret.status).end(ret.body);
    console.log("repl.deploy-success");
});

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
                let data = {
                    uid: user.id,
                    apiVersion: "v1"
                };

                let token = jwt.sign(data, process.env.JWT_SECRET, {
                    expiresIn: "30m"
                });

                let refreshData = {
                    uid: user.id,
                    token: token,
                    apiVersion: "v1"
                };

                let refreshToken = jwt.sign(refreshData, process.env.JWT_REFRESH_SECRET);

                res.json({ status: "OK", token: token, refreshToken: refreshToken });
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

api.delete("/v1/auth/logout", authMiddleware, async (req, res) => {
    let accessTokenExp = req.cableAuth.exp;

    let db = client.db("cablejs");
    let invalidTokens = db.collection("invalidTokens");

    let invalidTokenObj = await invalidTokens.findOne({ token: req.cableAuth.rawToken });
    if (invalidTokenObj) return res.status(400).json({ status: "BAD_REQUEST", message: "Session is already invalidated" });

    let ret = await invalidTokens.insertOne({
        expiresAt: new Date(Math.round(accessTokenExp * 1000)),
        token: req.cableAuth.rawToken
    });

    console.log(ret);
    res.status(204).end();
});

// Guild endpoints

api.post("/v1/guilds", authMiddleware, async (req, res) => {
    if (!req.body.name || typeof req.body.name != "string") return res.status(400).json({ status: "BAD_REQUEST" });

    let db = client.db("cablejs");

    let invalidTokens = db.collection("invalidTokens");

    let invalidToken = await invalidTokens.findOne({ token: req.cableAuth.rawToken });
    if (invalidToken) return res.status(403).json({ status: "FORBIDDEN", message: "Session is invalidated" });

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

    let invalidTokens = db.collection("invalidTokens");

    let invalidToken = await invalidTokens.findOne({ token: req.cableAuth.rawToken });
    if (invalidToken) return res.status(403).json({ status: "FORBIDDEN", message: "Session is invalidated" });

    let guilds = db.collection("guilds");

    let guild = await guilds.findOne({ gid: parseInt(gid) });

    delete guild._id;
    delete guild.members;

    res.json(guild);
});

api.get("/v1/guilds/:id/members", authMiddleware, async (req, res) => {
    let gid = req.params.id;

    let db = client.db("cablejs");

    let invalidTokens = db.collection("invalidTokens");

    let invalidToken = await invalidTokens.findOne({ token: req.cableAuth.rawToken });
    if (invalidToken) return res.status(403).json({ status: "FORBIDDEN", message: "Session is invalidated" });

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

    let invalidTokens = db.collection("invalidTokens");

    let invalidToken = await invalidTokens.findOne({ token: req.cableAuth.rawToken });
    if (invalidToken) return res.status(403).json({ status: "FORBIDDEN", message: "Session is invalidated" });

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

    let invalidTokens = db.collection("invalidTokens");

    let invalidToken = await invalidTokens.findOne({ token: req.cableAuth.rawToken });
    if (invalidToken) return res.status(403).json({ status: "FORBIDDEN", message: "Session is invalidated" });

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

    let invalidTokens = db.collection("invalidTokens");

    let invalidToken = await invalidTokens.findOne({ token: req.cableAuth.rawToken });
    if (invalidToken) return res.status(403).json({ status: "FORBIDDEN", message: "Session is invalidated" });

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

    let invalidTokens = db.collection("invalidTokens");

    let invalidToken = await invalidTokens.findOne({ token: req.cableAuth.rawToken });
    if (invalidToken) return res.status(403).json({ status: "FORBIDDEN", message: "Session is invalidated" });

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
    let invalidTokens = db.collection("invalidTokens");

    let invalidToken = await invalidTokens.findOne({ token: req.cableAuth.rawToken });
    if (invalidToken) return res.status(403).json({ status: "FORBIDDEN", message: "Session is invalidated" });

    let channels = db.collection("channels");

    // Use the $push operator to push a new message object into the array
    let ret = await channels.findOneAndUpdate({ id: parseInt(cid) }, {
        $push: {
            messages: {
                id: Math.floor(Math.random() * (Math.floor(100000) - Math.ceil(1) + 1)) + 1,
                author: req.cableAuth.uid,
                content: body.content,
                timestamp: new Date()
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

    let invalidTokens = db.collection("invalidTokens");

    let invalidToken = await invalidTokens.findOne({ token: req.cableAuth.rawToken });
    if (invalidToken) return res.status(403).json({ status: "FORBIDDEN", message: "Session is invalidated" });

    let channels = db.collection("channels");

    let channel = await channels.findOne({ id: parseInt(cid) });

    let message = channel.messages.find(messageObj => messageObj.id === parseInt(mid));
    if (message === undefined) return res.status(404).json({ status: "NOT_FOUND", message: "Message not found in specified channel" });

    res.json(message);
});

api.patch("/v1/channels/:cid/messages/:mid", authMiddleware, async (req, res) => {
    // Todo: Check author and edit

    let cid = req.params.cid;
    let mid = req.params.mid;

    let newContent = typeof req.body.content == "string" ? req.body.content : "";

    let db = client.db("cablejs");

    let invalidTokens = db.collection("invalidTokens");

    let invalidToken = await invalidTokens.findOne({ token: req.cableAuth.rawToken });
    if (invalidToken) return res.status(403).json({ status: "FORBIDDEN", message: "Session is invalidated" });

    let guilds = db.collection("guilds");
    let channels = db.collection("channels");

    let channel = await channels.findOne({ id: parseInt(cid) });

    if (!channel) return res.status(404).json({ status: "NOT_FOUND", message: "Channel not found" });
    let guild = await guilds.findOne({ gid: channel.gid });
    if (!guild) return res.status(404).json({ status: "NOT_FOUND", message: "Guild not found" });
    if (guild.members.find(guildMemberObj => guildMemberObj.user === req.cableAuth.uid) === undefined) return res.status(403).json({ status: "FORBIDDEN", message: "Missing access" });

    let channelMessage = channel.messages.find(channelMessageObj => channelMessageObj.id === parseInt(mid));
    if (!channelMessage) return res.status(404).json({ status: "NOT_FOUND", message: "Message not found in channel" });

    if (channelMessage.author != req.cableAuth.uid) return res.status(403).json({ status: "FORBIDDEN", message: "Missing access" });

    let ret = await channels.updateOne({ "messages.id": parseInt(mid) }, {
        $set: {
            "messages.$.content": newContent
        }
    });

    res.status(204).end();
});

api.delete("/v1/channels/:cid/messages/:mid", authMiddleware, async (req, res) => {
    // Todo: Check author and delete

    let cid = req.params.cid;
    let mid = req.params.mid;

    let db = client.db("cablejs");

    let invalidTokens = db.collection("invalidTokens");

    let invalidToken = await invalidTokens.findOne({ token: req.cableAuth.rawToken });
    if (invalidToken) return res.status(403).json({ status: "FORBIDDEN", message: "Session is invalidated" });

    let guilds = db.collection("guilds");
    let channels = db.collection("channels");

    let channel = await channels.findOne({ id: parseInt(cid) });

    if (!channel) return res.status(404).json({ status: "NOT_FOUND", message: "Channel not found" });
    let guild = await guilds.findOne({ gid: channel.gid });
    if (!guild) return res.status(404).json({ status: "NOT_FOUND", message: "Guild not found" });
    if (guild.members.find(guildMemberObj => guildMemberObj.user === req.cableAuth.uid) === undefined) return res.status(403).json({ status: "FORBIDDEN", message: "Missing access" });

    let channelMessage = channel.messages.find(channelMessageObj => channelMessageObj.id === parseInt(mid));
    if (!channelMessage) return res.status(404).json({ status: "NOT_FOUND", message: "Message not found in channel" });

    if (channelMessage.author != req.cableAuth.uid) return res.status(403).json({ status: "FORBIDDEN", message: "Missing access" });

    let ret = await channels.updateOne({ id: parseInt(cid) }, {
        $pull: {
            messages: {
                id: parseInt(mid)
            }
        }
    });

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

    let invalidTokens = db.collection("invalidTokens");

    let invalidToken = await invalidTokens.findOne({ token: req.cableAuth.rawToken });
    if (invalidToken) return res.status(403).json({ status: "FORBIDDEN", message: "Session is invalidated" });

    let users = db.collection("users");

    let user = await users.findOne({ id: req.cableAuth.uid });
    delete user.password;

    res.json(user);
});

api.get("/v1/users/@me/guilds", authMiddleware, async (req, res) => {
    let db = client.db("cablejs");

    let invalidTokens = db.collection("invalidTokens");

    let invalidToken = await invalidTokens.findOne({ token: req.cableAuth.rawToken });
    if (invalidToken) return res.status(403).json({ status: "FORBIDDEN", message: "Session is invalidated" });

    let users = db.collection("users");

    let user = await users.findOne({ id: req.cableAuth.uid });

    res.json(user.guilds);
});

api.delete("/v1/users/@me/guilds/:gid", authMiddleware, async (req, res) => {
    let gid = req.params.gid;

    let db = client.db("cablejs");

    let invalidTokens = db.collection("invalidTokens");

    let invalidToken = await invalidTokens.findOne({ token: req.cableAuth.rawToken });
    if (invalidToken) return res.status(403).json({ status: "FORBIDDEN", message: "Session is invalidated" });

    let users = db.collection("users");
    let guilds = db.collection("guilds");

    let ret = await guilds.findOneAndUpdate({ gid: parseInt(gid) }, {
        $pull: {
            members: {
                user: req.cableAuth.uid
            }
        }
    });

    console.log(ret);
    res.status(204).end();
});

api.get("/v1/users/:id", authMiddleware, async (req, res) => {
    let uid = req.params.id;

    let db = client.db("cablejs");

    let invalidTokens = db.collection("invalidTokens");

    let invalidToken = await invalidTokens.findOne({ token: req.cableAuth.rawToken });
    if (invalidToken) return res.status(403).json({ status: "FORBIDDEN", message: "Session is invalidated" });

    let users = db.collection("users");

    let user = await users.findOne({ id: parseInt(uid) });
    delete user.password;

    res.json(user);
});

api.get("/v1/users/:id/profile", authMiddleware, async (req, res) => {
    let uid = req.params.id;

    let db = client.db("cablejs");

    let invalidTokens = db.collection("invalidTokens");

    let invalidToken = await invalidTokens.findOne({ token: req.cableAuth.rawToken });
    if (invalidToken) return res.status(403).json({ status: "FORBIDDEN", message: "Session is invalidated" });

    let users = db.collection("users");

    let user = await users.findOne({ id: parseInt(uid) });

    res.json({
        mutual_guilds: null,
        premium_since: null,
        user: user
    });
});

// Staff endpoints

api.get("/v1/admin/invalidTokens", authMiddleware, async (req, res) => {
    let db = client.db("cablejs");
    let users = db.collection("users");

    let userRequesting = await users.findOne({ id: parseInt(req.cableAuth.uid) });

    if (!userRequesting.staff) return res.status(403).json({ status: "FORBIDDEN", message: "Missing access" });

    let invalidTokens = db.collection("invalidTokens");
    invalidTokens.find().toArray((err, ret) => {
        if (err) return res.status(500).json({ status: "SERVER_ERROR", message: err.message });

        ret.forEach(invalidTokenObj => {
            delete invalidTokenObj._id;
        });
        res.json(ret);
    });
});

// ----------------------------------------------------------------------

api.get("*", (_, res) => {
    res.status(404).json({ status: "NOT_FOUND" });
});

api.listen(3000, () => {
    console.log("Ready");
    try
    {
        client.connect((err, ret) => {
            if (err) throw err;
        });
    }
    catch (e) {}
});
