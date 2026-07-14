const jwt = require('jsonwebtoken');

module.exports = function (req, res, next) {
  // Get token from the frontend's Authorization header
  const authHeader = req.header('Authorization');
  
  if (!authHeader) {
    return res.status(401).json({ message: 'No token, authorization denied' });
  }

  try {
    // Neatly extract the token whether it includes the word "Bearer " or not
    const token = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : authHeader;
    
    // Decrypt the token and attach the user data (including their role) to the request
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded.user;
    next();
  } catch (err) {
    res.status(401).json({ message: 'Token is not valid' });
  }
};