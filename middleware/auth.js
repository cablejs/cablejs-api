const jwt = require("jsonwebtoken");

module.exports = function(req, res, next) {
    //if (!req.cookies.cableAuth) return res.status(401).json({ status: "UNAUTHORIZED" });
    let authToken = req.get("Authorization");
    if (authToken === undefined) return res.status(401).json({ status: "UNAUTHORIZED" });

    if (authToken.startsWith("Bearer "))
    {
        let token = authToken.split(" ")[1];

        try
        {
            req.cableAuth = jwt.verify(token, process.env.JWT_SECRET);
            req.cableAuth.rawToken = token;
        }
        catch (e)
        {
            return res.status(403).json({ status: "FORBIDDEN" });
        }
    }

    next();
};