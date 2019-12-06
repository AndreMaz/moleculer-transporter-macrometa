/*
 * moleculer-transporter-macrometa
 * Copyright (c) 2019 MoleculerJS (https://github.com/moleculerjs/moleculer-addons)
 * MIT Licensed
 */

"use strict";

const _ = require("lodash");
const Promise = require("bluebird");
const FabricClient = require("jsc8");
const { MoleculerError } = require("moleculer").Errors;
const BaseTransporter = require("moleculer").Transporters.Base;

// Imports to add some IntelliSense
const { Fabric, Stream } = require("jsc8"); // eslint-disable-line no-unused-vars

/**
 * Transporter for Macrometa
 *
 * More info: https://dev.macrometa.io/docs/streams-2
 *
 * @class MacrometaTransporter
 * 
 * @extends {BaseTransporter}
 */
class MacrometaTransporter extends BaseTransporter {

	/**
	 * Creates an instance of MacrometaTransporter.
	 *
	 * @param {any} opts
	 *
	 * @memberof MacrometaTransporter
	 */
	constructor(opts) {
		super(opts);

		this.opts = _.defaultsDeep({
			config: "https://gdn1.macrometa.io",
			auth: {},
			localStreams: false
		}, this.opts);

		this.streams = {};
	}
	
	/**
	 * Init transporter
	 * 
	 * @memberof MacrometaTransporter
	 */
	init() {
		super.init(...arguments);

		if (!this.opts.auth.email || !this.opts.auth.password) {
			throw new MoleculerError("The `email` and `password` fields are required to connect to Macrometa!");
		}

		const url = Array.isArray(this.opts.config)
			? this.opts.config[0]
			: this.opts.config;

		this.dcName = url.split("://")[1];
	}

	/**
	 * Connect to the transporter server
	 *
	 * @memberof MacrometaTransporter
	 */
	async connect() {
		/**
		 * @type {Fabric}
		 */
		this.fabric = new FabricClient(this.opts.config);

		this.logger.info(`Logging in with '${this.opts.auth.email}'...`);
		await this.fabric.login(this.opts.auth.email, this.opts.auth.password);
		this.logger.info("Logged in.");

		if (this.opts.tenant) {
			this.logger.info(`Switch tenant to '${this.opts.tenant}'`);
			this.fabric.useTenant(this.opts.tenant);
		}

		if (this.opts.fabric) {
			this.logger.info(`Switch Fabric to '${this.opts.fabric}'`);
			this.fabric.useFabric(this.opts.fabric);
		}

		this.logger.info("Fabric C8 connection has been established.");
		this.connected = true;

		this.onConnected();
	}

	/**
	 * Disconnect from the transporter server
	 *
	 * @memberof MacrometaTransporter
	 */
	disconnect() {
		if (this.fabric) {
			return this.fabric.close();
		}
		return Promise.resolve();
	}

	/**
	 * Subscribe to a command
	 *
	 * @param {String} cmd
	 * @param {String} nodeID
	 *
	 * @memberof MacrometaTransporter
	 */
	async subscribe(cmd, nodeID) {
		const t = this.getTopicName(cmd, nodeID);

		const stream = this.fabric.stream(t, this.opts.localStreams);
		this.streams[t] = stream;
		await stream.createStream();

		return new Promise((resolve, reject) => {
			let isConnected = false;

			stream.consumer(this.nodeID, {
				onopen: () => {
					isConnected = true;
					this.logger.debug("Stream consumer opened.");
					resolve();
				},
				onclose: () => this.logger.debug("Stream consumer closed."),
				onmessage: (msg) => {
					try {
						const d = JSON.parse(msg);
						if (d.payload != "") {
							const payload = Buffer.from(d.payload, "base64");
							this.receive(cmd, payload);
						}
					} catch(err) {
						this.logger.error("Unable to parse the incoming packet.", msg);
					}
				},
				onerror: (err) => {
					this.logger.error("Unable to open consumer stream.");
					if (!isConnected)
						reject(err);
				}
			}, this.dcName);
		});
	}

	/**
	 * Gets producer by topic
	 * 
	 * @param {string} topic
	 * @returns {Stream}
	 * 
	 * @memberof MacrometaTransporter
	 */
	async getProducerStream(topic) {
		let stream = this.streams[topic];
		if (stream)
			return stream;

		stream = this.fabric.stream(topic, this.opts.localStreams);
		this.streams[topic] = stream;
		await stream.createStream();
		return stream;
	}

	/**
	 * Send data buffer.
	 *
	 * @param {String} topic
	 * @param {Buffer} data
	 * @param {Object} meta
	 *
	 * @memberof MacrometaTransporter 
	 */
	async send(topic, data, meta) {
		/* istanbul ignore next*/
		if (!this.fabric) return Promise.resolve();

		const stream = await this.getProducerStream(topic);
		return stream.producer(data, this.dcName);
	}
}

module.exports = MacrometaTransporter;