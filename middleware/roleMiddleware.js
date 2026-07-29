// This function takes a list of allowed roles (e.g., 'SuperAdmin', 'LibraryOwner')
module.exports = function authorizeRoles(...allowedRoles) {
  return (req, res, next) => {
    // Check if the user's role is in the list of allowed roles for this route
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ 
        message: 'Access denied: You do not have the required permissions.' 
      });
    }
    
    // If they have the right role, let them pass!
    next();
  };
};