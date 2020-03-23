/* Node Modules */
import { Document, Model, ModelProperties, Schema, Types } from "mongoose";
import { forEachSeries } from "async";

export const DEFAULT_ID_FIELD = "_id";
export const DEFAULT_PARENT_FIELD = "parentReference";

export interface INestedSetHandler {
	lvl: number;
	lft: number;
	rgt: number;

	parent: (cb?: (err: any, res: any) => void) => Promise<INestedSetDocument>;
	children: (cb?: (err: any, res: any) => void) => Promise<INestedSetDocument[]>;
	siblings: (cb?: (err: any, res: any) => void) => Promise<INestedSetDocument[]>;
	isLeaf: () => boolean;
	isChild: () => boolean;
	isDescendantOf: (other: INestedSetDocument) => boolean;
	isAncestorOf: (other: INestedSetDocument) => boolean;

	selfAndAncestors: (filters?: any, fields?: any, options?: any, callback?: (err?: any, res?: any) => void) => Promise<INestedSetDocument[]>;
	ancestors: (filters?: any, fields?: any, options?: any, callback?: (err?: any, res?: any) => void) => Promise<INestedSetDocument[]>;
	selfAndChildren: (filters?: any, fields?: any, options?: any, callback?: (err?: any, res?: any) => void) => Promise<INestedSetDocument[]>;
	selfAndDescendants: (filters?: any, fields?: any, options?: any, callback?: (err?: any, res?: any) => void) => Promise<INestedSetDocument[]>;
	descendants: (filters?: any, fields?: any, options?: any, callback?: (err?: any, res?: any) => void) => Promise<INestedSetDocument[]>;
	selfAndSiblings: (filters?: any, fields?: any, options?: any, callback?: (err?: any, res?: any) => void) => Promise<INestedSetDocument[]>;
	level: (cb?: (err?: any, res?: any) => void) => Promise<number>;
	rebuildTree: (parent: INestedSetDocument, lft: number, cb?: (err?: any, res?: any) => void) => Promise<INestedSetDocument[]>;

}

export interface INestedSetDocument extends INestedSetHandler {
	constructor: Model<Document & INestedSetDocument> & ModelProperties;
}

interface INestedSetOptions {
	idFieldName?: string;
	parentFieldName?: string;
	parentFieldType?: any;
	groupingKey?: any;
}

export const NestedSetPlugin = (schema: Schema, options?: INestedSetOptions) => {
	options = options || {};

	const {
		idFieldName = DEFAULT_ID_FIELD,
		parentFieldName = DEFAULT_PARENT_FIELD,
		parentFieldType = Schema.Types.ObjectId,
		groupingKey
	} = options;

	schema.add({ lft: { type: Number, min: 0 } });
	schema.add({ rgt: { type: Number, min: 0 } });

	// Allows level computing while editing the graph
	schema.add({ lvl: { type: Number, min: 0, default: 0 } });
	schema.index({ lvl: 1 });

	schema.add({ [parentFieldName]: { type: parentFieldType } });

	schema.index({ [parentFieldName]: 1 });
	schema.index({ lft: 1, rgt: 1 });
	schema.index({ rgt: 1 });

	const updateConditions = function (conditions, item) {
		if (groupingKey) {
			conditions[groupingKey] = item[groupingKey];
		}
		return conditions;
	};

	schema.pre('save', function (next): void {
		const self: Model<Document & INestedSetDocument> & INestedSetDocument = this as any;
		if (self[parentFieldName]) {
			self.parent(function (err, parentNode) {
				if (!err && parentNode && parentNode["lft"] && parentNode["rgt"]) {
					//Update level based on parentNode level
					self["lvl"] = parentNode["lvl"] + 1
					// find siblings and check if they have lft and rgt values set
					self.siblings(function (err, nodes) {
						if (nodes.every(function (node) { return node["lft"] && node["rgt"]; })) {
							let maxRgt = 0;
							nodes.forEach(function (node) {
								if (node["rgt"] > maxRgt) {
									maxRgt = node["rgt"];
								}
							});
							if (nodes.length === 0) {
								// if it is a leaf node, the maxRgt should be the lft value of the parent
								maxRgt = parentNode["lft"];
							}
							let conditions = updateConditions({ lft: { $gt: maxRgt } }, self);
							self.constructor.updateMany(conditions, { $inc: { lft: 2 } }, function (err, updatedCount) {
								conditions = updateConditions({ rgt: { $gt: maxRgt } }, self);
								self.constructor.updateMany(conditions, { $inc: { rgt: 2 } }, function (err, updatedCount2) {
									self["lft"] = maxRgt + 1;
									self["rgt"] = maxRgt + 2;
									next();
								});
							});
						} else {
							// the siblings do not have lft and rgt set. This means tree was not build.
							// warn on console and move on.
							// console.log('WARNING: tree is not built for ' + modelName + ' nodes. Siblings does not have lft/rgt');
							next();
						}
					});
				} else {
					// parent node does not have lft and rgt set. This means tree was not built.
					// warn on console and move on.
					// console.log('WARNING: tree is not built for ' + modelName + ' nodes. Parent does not have lft/rgt');
					next();
				}
			});
		} else {
			// no parentId is set, so ignore
			next();
		}
	});

	schema.pre('remove', function (next) {
		const self: Model<Document & INestedSetDocument> & INestedSetDocument = this as any;
		if (self[parentFieldName]) {
			self.parent(function (err, parentNode) {
				if (!err && parentNode && parentNode["lft"] && parentNode["rgt"]) {

					// find siblings and check if they have lft and rgt values set
					self.siblings(function (err, nodes) {
						if (nodes.every(function (node) { return node["lft"] && node["rgt"]; })) {
							let maxRgt = 0;
							nodes.forEach(function (node) {
								if (node["rgt"] > maxRgt) {
									maxRgt = node["rgt"];
								}
							});
							if (nodes.length === 0) {
								// if it is a leaf node, the maxRgt should be the lft value of the parent
								maxRgt = parentNode["lft"];
							}
							let conditions = updateConditions({ lft: { $gt: maxRgt } }, self);
							self.constructor.updateMany(conditions, { $inc: { lft: -2 } }, function (err, updatedCount) {
								conditions = updateConditions({ rgt: { $gt: maxRgt } }, self);
								self.constructor.updateMany(conditions, { $inc: { rgt: -2 } }, function (err, updatedCount2) {
									next();
								});
							});
						} else {
							// the siblings do not have lft and rgt set. This means tree was not build.
							// warn on console and move on.
							// console.log('WARNING: tree is not built for ' + modelName + ' nodes. Siblings does not have lft/rgt');
							next();
						}
					});
				} else {
					// parent node does not have lft and rgt set. This means tree was not built.
					// warn on console and move on.
					// console.log('WARNING: tree is not built for ' + modelName + ' nodes. Parent does not have lft/rgt');
					next();
				}
			});
		} else {
			// no parentId is set, so ignore
			next();
		}
	});

	// Builds the tree by populating lft and rgt using the parentIds
	schema.static('rebuildTree', async function (parent: INestedSetDocument, left: number, callback?: (err?: any, res?: any) => void): Promise<INestedSetDocument[]> {
		const self: Model<Document & INestedSetDocument> & INestedSetDocument = this;
		parent["lft"] = left;
		parent["rgt"] = left + 1;

		const children = await self.find({ [parentFieldName]: parent[idFieldName] }, { [parentFieldName]: true, rgt: true, lft: true }, { lean: true });

		if (!children) {
			if (callback) {
				return callback(new Error(self.constructor.modelName + ' not found')) as any;
			} else {
				throw new Error(self.constructor.modelName + ' not found');
			}
		}

		return new Promise(async (resolve, reject) => {

			if (children.length > 0) {
				forEachSeries(children, (item: INestedSetDocument, cb) => {
					self.rebuildTree(item, parent["rgt"], function () {
						parent["rgt"] = item["rgt"] + 1;
						self.updateOne({ [idFieldName]: parent[idFieldName] }, { lft: parent["lft"], rgt: parent["rgt"] }, cb);
					});
				}, function () {
					if (callback) {
						callback();
					}
					resolve();
				});
			} else {
				await self.updateOne({ [idFieldName]: parent[idFieldName] }, { lft: parent["lft"], rgt: parent["rgt"] });
				if (callback) {
					callback();
				}
				resolve();
			}
		});
	});

	// Returns true if the node is a leaf node (i.e. has no children)
	schema.method('isLeaf', function (): boolean {
		return this["lft"] && this["rgt"] && (this["rgt"] - this["lft"] === 1);
	});

	// Returns true if the node is a child node (i.e. has a parent)
	schema.method('isChild', function (): boolean {
		return !!this[parentFieldName];
	});

	// Returns true if other is a descendant of self
	schema.method('isDescendantOf', function (other: INestedSetDocument): boolean {
		const self: Model<Document & INestedSetDocument> & INestedSetDocument = this;
		return other["lft"] < self["lft"] && self["lft"] < other["rgt"];
	});

	// Returns true if other is an ancestor of self
	schema.method('isAncestorOf', function (other: INestedSetDocument): boolean {
		const self: Model<Document & INestedSetDocument> & INestedSetDocument = this;
		return self["lft"] < other["lft"] && other["lft"] < self["rgt"];
	});

	// returns the parent node
	schema.method('parent', async function (callback: (err: any, res: any) => void): Promise<INestedSetDocument> {
		const self: Model<Document & INestedSetDocument> & INestedSetDocument = this;
		return self.constructor.findOne({ [idFieldName]: self[parentFieldName] }, callback);
	});

	// Returns the list of ancestors + current node
	schema.method('selfAndAncestors', async function (filters?: any, fields?: any, options?: any, callback?: (err?: any, res?: any) => void): Promise<INestedSetDocument[]> {
		const self: Model<Document & INestedSetDocument> & INestedSetDocument = this;
		if ('function' === typeof filters) {
			callback = filters;
			filters = {};
		}
		else if ('function' === typeof fields) {
			callback = fields;
			fields = null;
		}
		else if ('function' === typeof options) {
			callback = options;
			options = {};
		}

		filters = filters || {};
		fields = fields || null;
		options = options || {};

		if (filters['$query']) {
			filters['$query']['lft'] = { $lte: self["lft"] };
			filters['$query']['rgt'] = { $gte: self["rgt"] };
		} else {
			filters['lft'] = { $lte: self["lft"] };
			filters['rgt'] = { $gte: self["rgt"] };
		}
		return self.constructor.find(filters, fields, options, callback);
	});

	// Returns the list of ancestors
	schema.method('ancestors', async function (filters?: any, fields?: any, options?: any, callback?: (err?: any, res?: any) => void): Promise<INestedSetDocument[]> {
		const self: Model<Document & INestedSetDocument> & INestedSetDocument = this;

		if ('function' === typeof filters) {
			callback = filters;
			filters = {};
		}
		else if ('function' === typeof fields) {
			callback = fields;
			fields = null;
		}
		else if ('function' === typeof options) {
			callback = options;
			options = {};
		}

		filters = filters || {};
		fields = fields || null;
		options = options || {};

		if (filters['$query']) {
			filters['$query']['lft'] = { $lt: self["lft"] };
			filters['$query']['rgt'] = { $gt: self["rgt"] };
		} else {
			filters['lft'] = { $lt: self["lft"] };
			filters['rgt'] = { $gt: self["rgt"] };
		}
		return self.constructor.find(filters, fields, options, callback);
	});

	// Returns the list of children
	schema.method('children', async function (filters?: any, fields?: any, options?: any, callback?: (err?: any, res?: any) => void): Promise<INestedSetDocument[]> {
		const self: Model<Document & INestedSetDocument> & INestedSetDocument = this;
		if ('function' === typeof filters) {
			callback = filters;
			filters = {};
		}
		else if ('function' === typeof fields) {
			callback = fields;
			fields = null;
		}
		else if ('function' === typeof options) {
			callback = options;
			options = {};
		}

		filters = filters || {};
		fields = fields || null;
		options = options || {};

		if (filters['$query']) {
			filters['$query'][parentFieldName] = self[idFieldName];
		} else {
			filters[parentFieldName] = self[idFieldName];
		}
		return self.constructor.find(filters, fields, options, callback);
	});

	// Returns the list of children + current node
	schema.method('selfAndChildren', async function (filters?: any, fields?: any, options?: any, callback?: (err?: any, res?: any) => void): Promise<INestedSetDocument[]> {
		const self: Model<Document & INestedSetDocument> & INestedSetDocument = this;
		if ('function' === typeof filters) {
			callback = filters;
			filters = {};
		}
		else if ('function' === typeof fields) {
			callback = fields;
			fields = null;
		}
		else if ('function' === typeof options) {
			callback = options;
			options = {};
		}

		filters = filters || {};
		fields = fields || null;
		options = options || {};

		if (filters['$query']) {
			filters['$query']['$or'] = [{ [parentFieldName]: self[idFieldName] }, { [idFieldName]: self[idFieldName] }];
		} else {
			filters['$or'] = [{ [parentFieldName]: self[idFieldName] }, { [idFieldName]: self[idFieldName] }];
		}
		return self.constructor.find(filters, fields, options, callback);
	});

	// Returns the list of descendants + current node
	schema.method('selfAndDescendants', async function (filters?: any, fields?: any, options?: any, callback?: (err?: any, res?: any) => void): Promise<INestedSetDocument[]> {
		const self: Model<Document & INestedSetDocument> & INestedSetDocument = this;
		if ('function' === typeof filters) {
			callback = filters;
			filters = {};
		}
		else if ('function' === typeof fields) {
			callback = fields;
			fields = null;
		}
		else if ('function' === typeof options) {
			callback = options;
			options = {};
		}

		filters = filters || {};
		fields = fields || null;
		options = options || {};

		if (filters['$query']) {
			filters['$query']['lft'] = { $gte: self["lft"] };
			filters['$query']['rgt'] = { $lte: self["rgt"] };
		} else {
			filters['lft'] = { $gte: self["lft"] };
			filters['rgt'] = { $lte: self["rgt"] };
		}
		return self.constructor.find(filters, fields, options, callback);
	});

	// Returns the list of descendants
	schema.method('descendants', async function (filters?: any, fields?: any, options?: any, callback?: (err?: any, res?: any) => void): Promise<INestedSetDocument[]> {
		const self: Model<Document & INestedSetDocument> & INestedSetDocument = this;
		if ('function' === typeof filters) {
			callback = filters;
			filters = {};
		}
		else if ('function' === typeof fields) {
			callback = fields;
			fields = null;
		}
		else if ('function' === typeof options) {
			callback = options;
			options = {};
		}

		filters = filters || {};
		fields = fields || null;
		options = options || {};

		if (filters['$query']) {
			filters['$query']['lft'] = { $gt: self["lft"] };
			filters['$query']['rgt'] = { $lt: self["rgt"] };
		} else {
			filters['lft'] = { $gt: self["lft"] };
			filters['rgt'] = { $lt: self["rgt"] };
		}
		return self.constructor.find(filters, fields, options, callback);
	});

	// Returns the list of all nodes with the same parent + current node
	schema.method('selfAndSiblings', async function (filters: any, fields: any, options: any, callback: (err?: any, res?: any) => void): Promise<INestedSetDocument[]> {
		const self: Model<Document & INestedSetDocument> & INestedSetDocument = this;
		if ('function' === typeof filters) {
			callback = filters;
			filters = {};
		}
		else if ('function' === typeof fields) {
			callback = fields;
			fields = null;
		}
		else if ('function' === typeof options) {
			callback = options;
			options = {};
		}

		filters = filters || {};
		fields = fields || null;
		options = options || {};

		if (filters['$query']) {
			filters['$query'][parentFieldName] = self[parentFieldName];
		} else {
			filters[parentFieldName] = self[parentFieldName];
		}
		return self.constructor.find(filters, fields, options, callback);
	});

	// Returns the list of all nodes with the same parent
	schema.method('siblings', async function (filters?: any, fields?: any, options?: any, callback?: (err?: any, res?: any) => void): Promise<INestedSetDocument[]> {
		const self: Model<Document & INestedSetDocument> & INestedSetDocument = this;
		if ('function' === typeof filters) {
			callback = filters;
			filters = {};
		}
		else if ('function' === typeof fields) {
			callback = fields;
			fields = null;
		}
		else if ('function' === typeof options) {
			callback = options;
			options = {};
		}

		filters = filters || {};
		fields = fields || null;
		options = options || {};

		if (filters['$query']) {
			filters['$query'][parentFieldName] = self[parentFieldName];
			filters['$query'][idFieldName] = { $ne: self[idFieldName] };
		} else {
			filters[parentFieldName] = self[parentFieldName];
			filters[idFieldName] = { $ne: self[idFieldName] };
		}
		return self.constructor.find(filters, fields, options, callback);
	});

	// Returns the level of this object in the tree. Root level is 0
	schema.method('level', async function (callback): Promise<number> {
		const self: Model<Document & INestedSetDocument> & INestedSetDocument = this;
		const ancestors = await self.ancestors(function (err, nodes) {
			if (callback) callback(err, nodes.length);
		});
		return ancestors.length;
	});
};

export default NestedSetPlugin;