const HtmlWebpackPlugin = require('html-webpack-plugin');
const vm = require('vm');
const Partial = require('./lib/partial');
const path = require('path');
const Util = require('./lib/util');

//const loader = require('html-webpack-plugin').loader;

/**
 * HtmlWebpackPartialsPlugin
 * @description Webpack plugin based on HTML Webpack Plugin that allows partial injection into the compiled HTML
 */

class HtmlWebpackPartialsPlugin {
	static filesProcessed = [];

  constructor(settings = {}) {
    this.settings = settings;
  }

  apply(compiler) {
	const { webpack } = compiler;
	const { Compilation } = webpack;
	const { RawSource } = webpack.sources;

	// If the input isn't an array, add it as one to simplify the process

	if ( !Array.isArray(this.settings) ) {
		this.settings = [ this.settings ];
	}

	this.partial_collection = this.settings.map(partial => {
		return new Partial(partial);
	});

	//
	compiler.hooks.make.tapAsync(
		'HtmlWebpackPartialsPlugin',
		(mainCompilation, callback) => {
			// CODE EXTRACT FROM html-webpack-plugin/lib/child-compiler.js
			const NodeTemplatePlugin = webpack.node.NodeTemplatePlugin;
			const NodeTargetPlugin = webpack.node.NodeTargetPlugin;
			const LoaderTargetPlugin = webpack.LoaderTargetPlugin;
			const EntryPlugin = webpack.EntryPlugin;

			const outputOptions = {
				filename: 'HtmlWebpackPartialPlugin-[name]',
				publicPath: '',
				library: {
					type: 'var',
					name: 'HTML_WEBPACK_PLUGIN_RESULT'
				},
				scriptType: /** @type {'text/javascript'} */('text/javascript'),
				iife: true
			};

			const compilerName = 'HtmlWebpackPartialsCompiler';
			// Create an additional child compiler which takes the template
			// and turns it into an Node.JS html factory.
			// This allows us to use loaders during the compilation
			const childCompiler = mainCompilation.createChildCompiler(compilerName, outputOptions, [
				// Compile the template to nodejs javascript
				new NodeTargetPlugin(),
				new NodeTemplatePlugin(),
				new LoaderTargetPlugin('node'),
				new webpack.library.EnableLibraryPlugin('var')
			]);
			// The file path context which webpack uses to resolve all relative files to
			childCompiler.context = mainCompilation.compiler.context;

			// END CODE EXTRACT FROM html-webpack-plugin/lib/child-compiler.js

			this.partial_collection.forEach(partial => {
				new EntryPlugin(childCompiler.context, 'data:text/javascript,__webpack_public_path__ = __webpack_base_uri__ = htmlWebpackPartialsPluginPublicPath;',partial.unique_name).apply(childCompiler);

				new EntryPlugin(childCompiler.context, '/media/sgb004/2TB/www/html-webpack-partials-plugin/node_modules/html-webpack-plugin/lib/loader.js!'+partial.path, partial.unique_name).apply(childCompiler);
			});

			childCompiler.hooks.thisCompilation.tap('HtmlWebpackPartialsPlugin', (compilation) => {
				compilation.hooks.processAssets.tap(
				{
					name: 'HtmlWebpackPartialsPlugin',
					stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONS
				},
				(assets) => {
					this.partial_collection.forEach(partial => {
						const temporaryTemplateName = outputOptions.filename.replace('[name]', partial.unique_name);
						if (assets[temporaryTemplateName]) {
							const publicPath = this.getPublicPath(mainCompilation, temporaryTemplateName);

							const source = this.getHTMLSource(assets[temporaryTemplateName].source(), partial, publicPath);
							partial.createTemplate(source);
							compilation.deleteAsset(temporaryTemplateName);
						}
					});
				  }
				);
			});
			
			childCompiler.runAsChild(callback);
		}
	);

	// Get list of files processed by HtmlWebpackPlugin

	compiler.hooks.compilation.tap('HtmlWebpackPartialsPlugin', compilation => {
		HtmlWebpackPlugin.getHooks(compilation).beforeEmit.tapAsync('HtmlWebpackPartialsPlugin', (data, cb) => {
			!HtmlWebpackPartialsPlugin.filesProcessed.includes(data.outputName) ? HtmlWebpackPartialsPlugin.filesProcessed.push(data.outputName) : '';
			cb(null, data);
		});
	});

	// Use this hook and this stage to ensure that all assets were already added to the compilation by other plugins
	// and we can use to get htmls and put partial in them

	compiler.hooks.thisCompilation.tap('HtmlWebpackPartialsPlugin', (compilation) => {
		compilation.hooks.processAssets.tap(
			{
				name: 'HtmlWebpackPartialsPlugin',
				stage: Compilation.PROCESS_ASSETS_STAGE_SUMMARIZE,
			},
			(assets) => {
				this.partial_collection.forEach(partial => {
					// Get list of files to add partial
					let filesProcessed = partial.template_filename;
					if(!Array.isArray(partial.template_filename)){
						filesProcessed = filesProcessed == '*' ? HtmlWebpackPartialsPlugin.filesProcessed : [partial.template_filename];
					}

					filesProcessed.forEach( template_filename => {
						//We get the html template where the partial will be injected
						const dataHtml = compilation.getAsset(template_filename).source._value;

						// Inject the partial into the HTML template
						const html = Util.injectPartial(dataHtml, {
							options: partial.options,
							// We get the partial and transform it in a loash template to pass options
							html: partial.template,
							priority: partial.priority,
							location: partial.location,
						});
	
						compilation.updateAsset(template_filename, new RawSource(html));
					});
				});
				
			});
		}
	);
  }

  getHTMLSource(source, partial, publicPath){
	if (source.indexOf('HTML_WEBPACK_PLUGIN_RESULT') >= 0) {
		source += ';\nHTML_WEBPACK_PLUGIN_RESULT';
	}

	const vmContext = vm.createContext({
		...global,
		HTML_WEBPACK_PLUGIN: true,
		require: require,
		htmlWebpackPartialsPluginPublicPath: 'hwpp:/'+publicPath, //Added hwpp:/ because sometimes publicPath is empty and causes an error
		URL: require('url').URL,
		__filename: partial.path
	});

	const vmScript = new vm.Script(source, { filename: partial.path });

	let newSource;
	try {
		newSource = vmScript.runInContext(vmContext);
	} catch (e) {
		return Promise.reject(e);
	}

	if (typeof newSource === 'object' && newSource.__esModule && newSource.default) {
		newSource = newSource.default;
	}

	return typeof newSource === 'string' || typeof newSource === 'function'
	? Promise.resolve(newSource)
	: Promise.reject('The loader "' + partial.path + '" didn\'t return html.');
  }

  	// CODE EXTRACT FROM html-webpack-plugin/index.js with a few minor modifications 
	/**
	 * Generate the relative or absolute base url to reference images, css, and javascript files
	 * from within the html file - the publicPath
	 *
	 * @param {WebpackCompilation} compilation
	 * @param {string} childCompilationOutputName
	 * @returns {string}
	 */
	getPublicPath (compilation, childCompilationOutputName) {
		const compilationHash = compilation.hash;

		/**
		 * @type {string} the configured public path to the asset root
		 * if a path publicPath is set in the current webpack config use it otherwise
		 * fallback to a relative path
		 */
		const webpackPublicPath = compilation.getAssetPath(compilation.outputOptions.publicPath, { hash: compilationHash });

		// Webpack 5 introduced "auto" as default value
		const isPublicPathDefined = webpackPublicPath !== 'auto';

		let publicPath =
			isPublicPathDefined
				// If a hard coded public path exists use it
				? webpackPublicPath
				// If no public path was set get a relative url path
				: path.relative(path.resolve(compilation.options.output.path, path.dirname(childCompilationOutputName)), compilation.options.output.path)
				.split(path.sep).join('/');

		if (publicPath.length && publicPath.slice(publicPath.length - 1) !== '/') {
			publicPath += '/';
		}

		return publicPath;
	}
	// END CODE EXTRACT FROM
}

module.exports = HtmlWebpackPartialsPlugin;