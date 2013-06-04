global._ = require("./public/lib/3party/underscore-1.4.4.js") ;
require("./lib/core/reset.js") ;
require("./lib/mvc/Former.js") ;
var Application = require("./lib/core/Application.js") ;

exports.createApplication = function(rootFolder){
	return new Application(rootFolder||process.cwd()) ;
}