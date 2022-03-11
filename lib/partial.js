const fs = require('fs');
const path = require('path');
const _template = require('lodash/template');
const { v4: uuidv4 } = require('uuid');

/**
 * Partial
 * @description Instance of a partial file
 */

class Partial {

  constructor(settings = {}) {
    this.path = settings.path;
    this.location = settings.location || 'body';
    this.priority = settings.priority || 'low';
    this.should_inject = typeof settings.inject === 'undefined' ? true : !!(settings.inject);
    this.template_filename = settings.template_filename || 'index.html';
    this.options = Object.assign({}, settings.options);
	this.unique_name = uuidv4() + '.html'; //With html ext to html-loader
  }

  /**
   * createTemplate
   * @param source Promise that receives the result to transform 
   * @description Reads the source and transforms it into a loash template
   */

  createTemplate(source) {
	source.then( source => {
		//Remove 'hwpp:/' previously added, it is not necessary
		source = source.replace(new RegExp('hwpp:/', 'g'), '');

		this.template = _template(source);
		//When using html-loader and HTMLWebpackPlugin it doesn't process the options so we send them again 
		this.template = this.template(this.options);
	})
	.catch( e => {
		throw new Error(e);
	});
  }

}

module.exports = Partial;