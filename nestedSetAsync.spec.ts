import { model, Model, Document, Types, Schema } from "mongoose";
import * as assert from "assert";
import * as async from "async";
import {
	NestedSetPlugin,
	INestedSetDocument
} from "../../../shared/mongoose/nestedSet";

let UserSchema: Schema<IUser & INestedSetDocument> & INestedSetDocument;
let User: Model<(INestedSetDocument & Document & IUser), any> & INestedSetDocument;

interface IUser {
	username: string;
}

describe('NestedSet Promise', function () {

	const idFieldName = "id";
	const parentFieldName = "parentReference";

	before(function (done) {
		async.series([
			function (callback) {

				UserSchema = new Schema({
					username: { type: String },
				}, { versionKey: false }) as any;
				UserSchema.plugin(NestedSetPlugin, { parentFieldName: "parentReference" });
				User = model<Document & INestedSetDocument & IUser>('UserTestAsync', UserSchema) as any;
				callback(null);
			},
			function (callback) {
				// see diagram in docs/test_tree.png for a representation of this tree
				let michael = new User({ username: 'michael' });

				let meredith = new User({ username: 'meredith', [parentFieldName]: michael[idFieldName] });
				let jim = new User({ username: 'jim', [parentFieldName]: michael[idFieldName] });
				let angela = new User({ username: 'angela', [parentFieldName]: michael[idFieldName] });

				let kelly = new User({ username: 'kelly', [parentFieldName]: meredith[idFieldName] });
				let creed = new User({ username: 'creed', [parentFieldName]: meredith[idFieldName] });

				let phyllis = new User({ username: 'phyllis', [parentFieldName]: jim[idFieldName] });
				let stanley = new User({ username: 'stanley', [parentFieldName]: jim[idFieldName] });
				let dwight = new User({ username: 'dwight', [parentFieldName]: jim[idFieldName] });

				let oscar = new User({ username: 'oscar', [parentFieldName]: angela[idFieldName] });

				async.eachSeries([
					michael,
					meredith,
					jim,
					angela,
					kelly,
					creed,
					phyllis,
					stanley,
					dwight,
					oscar
				], function (item, cb) {
					item.save(cb);
				}, callback);
			}
		], function (err, results) {
			if (!err) done();
		});
	});

	it('is same', async () => {
		assert.ok(User);
		assert.equal('function', typeof User);
		assert.equal('UserTestAsync', User.modelName);
	});

	it('has created users for testing', async () => {
		const users = await User.find();
		assert.ok(users);
		assert.ok(users instanceof Array);
		assert.equal(10, users.length);
	});

	it('can read [parentFieldName]s as ObjectIDs', async () => {
		const users = await User.find();
		users.forEach(function (user) {
			if (user[parentFieldName]) {
				assert.ok(Types.ObjectId.isValid(user[parentFieldName]));
			}
		});
	});

	it('rebuildTree should set lft and rgt based on [parentFieldName]s', async () => {
		const user = await User.findOne({ username: 'michael' }).lean().exec();
		await User.rebuildTree(user, 1);
		const users = await User.find({}).lean().exec();
		// see docs/test_tree.png for the graphical representation of this tree with lft/rgt values
		users.forEach(function (person) {
			if (person.username === 'michael') {
				assert.equal(1, person.lft);
				assert.equal(20, person.rgt);
			} else if (person.username === 'meredith') {
				assert.equal(2, person.lft);
				assert.equal(7, person.rgt);
			} else if (person.username === 'jim') {
				assert.equal(8, person.lft);
				assert.equal(15, person.rgt);
			} else if (person.username === 'angela') {
				assert.equal(16, person.lft);
				assert.equal(19, person.rgt);
			} else if (person.username === 'kelly') {
				assert.equal(3, person.lft);
				assert.equal(4, person.rgt);
			} else if (person.username === 'creed') {
				assert.equal(5, person.lft);
				assert.equal(6, person.rgt);
			} else if (person.username === 'phyllis') {
				assert.equal(9, person.lft);
				assert.equal(10, person.rgt);
			} else if (person.username === 'stanley') {
				assert.equal(11, person.lft);
				assert.equal(12, person.rgt);
			} else if (person.username === 'dwight') {
				assert.equal(13, person.lft);
				assert.equal(14, person.rgt);
			} else if (person.username === 'oscar') {
				assert.equal(17, person.lft);
				assert.equal(18, person.rgt);
			}
		});
	});

	it('isLeaf should return true if node is leaf', async () => {
		const user = await User.findOne({ username: 'michael' })
		await User.rebuildTree(user, 1);
		const kelly = await User.findOne({ username: 'kelly' });
		assert.ok(kelly.isLeaf());
		const michael = await User.findOne({ username: 'michael' });
		assert.ok(!michael.isLeaf());
	});

	it('isChild should return true if node has a parent', async () => {
		const user = await User.findOne({ username: 'michael' });
		await User.rebuildTree(user, 1);
		const kelly = await User.findOne({ username: 'kelly' });
		assert.ok(kelly.isChild());
		const michael = await User.findOne({ username: 'michael' });
		assert.ok(!michael.isChild());
	});

	it('parent should return parent node', async () => {
		const user = await User.findOne({ username: 'michael' });
		await User.rebuildTree(user, 1);
		const kelly = await User.findOne({ username: 'kelly' });
		assert.ok(kelly);
		const node = await kelly.parent();
		assert.equal('meredith', node.username);
	});

	it('selfAndAncestors should return all ancestors higher up in tree + current node', async () => {
		const user = await User.findOne({ username: 'michael' });
		await User.rebuildTree(user, 1);
		const kelly = await User.findOne({ username: 'kelly' });
		const people = await kelly.selfAndAncestors();
		assert.deepEqual(['kelly', 'meredith', 'michael'], people.map(function (p) {
			return p.username;
		}).sort());
	});

	it('ancestors should return all ancestors higher up in tree', async () => {
		const user = await User.findOne({ username: 'michael' });
		await User.rebuildTree(user, 1);
		const kelly = await User.findOne({ username: 'kelly' });
		const people = await kelly.ancestors();
		assert.deepEqual(['meredith', 'michael'], people.map(function (p) {
			return p.username;
		}).sort());
	});

	it('ancestors should return empty array if it is a root node', async () => {
		const user = await User.findOne({ username: 'michael' });
		await User.rebuildTree(user, 1);
		const michael = await User.findOne({ username: 'michael' });
		const people = await michael.ancestors();
		assert.deepEqual([], people.map(function (p) {
			return p.username;
		}).sort());
	});

	it('selfAndChildren should return all children + current node', async () => {
		const user = await User.findOne({ username: 'michael' });
		await User.rebuildTree(user, 1);
		const michael = await User.findOne({ username: 'michael' });
		const people = await michael.selfAndChildren();
		assert.deepEqual(['angela', 'jim', 'meredith', 'michael'], people.map(function (p) {
			return p.username;
		}).sort());
	});

	it('children should return all children', async () => {
		const user = await User.findOne({ username: 'michael' });
		await User.rebuildTree(user, 1);
		const michael = await User.findOne({ username: 'michael' });
		const people = await michael.children();
		assert.deepEqual(['angela', 'jim', 'meredith'], people.map(function (p) {
			return p.username;
		}).sort());
	});

	it('selfAndDescendants should return all descendants + current node', async () => {
		const user = await User.findOne({ username: 'michael' });
		await User.rebuildTree(user, 1);
		const michael = await User.findOne({ username: 'michael' });
		const people = await michael.selfAndDescendants();
		assert.deepEqual(
			['angela', 'creed', 'dwight', 'jim', 'kelly', 'meredith', 'michael', 'oscar', 'phyllis', 'stanley'],
			people.map(function (p) {
				return p.username;
			}).sort()
		);
	});

	it('descendants should return all descendants', async () => {
		const user = await User.findOne({ username: 'michael' });
		await User.rebuildTree(user, 1);
		const michael = await User.findOne({ username: 'michael' });
		const people = await michael.descendants();
		assert.deepEqual(
			['angela', 'creed', 'dwight', 'jim', 'kelly', 'meredith', 'oscar', 'phyllis', 'stanley'],
			people.map(function (p) {
				return p.username;
			}).sort()
		);
	});

	it('level should return 0 for root node', async () => {
		const user = await User.findOne({ username: 'michael' });
		await User.rebuildTree(user, 1);
		const michael = await User.findOne({ username: 'michael' });
		const value = await michael.level();
		assert.equal(0, value);
	});

	it('selfAndSiblings should return all nodes with same parent node + current node', async () => {
		const user = await User.findOne({ username: 'michael' });
		await User.rebuildTree(user, 1);
		const meredith = await User.findOne({ username: 'meredith' });
		const people = await meredith.selfAndSiblings();
		assert.deepEqual(
			['angela', 'jim', 'meredith'],
			people.map(function (p) {
				return p.username;
			}).sort()
		);
	});

	it('siblings should return all nodes with same parent node', async () => {
		const user = await User.findOne({ username: 'michael' });
		User.rebuildTree(user, 1);
		const meredith = await User.findOne({ username: 'meredith' });
		const people = await meredith.siblings();
		assert.deepEqual(
			['angela', 'jim'],
			people.map(function (p) {
				return p.username;
			}).sort()
		);
	});

	it('kelly is a descendant of michael', async () => {
		const michael = await User.findOne({ username: 'michael' });
		await User.rebuildTree(michael, 1);
		const kelly = await User.findOne({ username: 'kelly' });
		assert.ok(kelly.isDescendantOf(michael));
		assert.ok(!michael.isDescendantOf(kelly));
	});

	it('michael is an ancestor of kelly', async () => {
		const michael = await User.findOne({ username: 'michael' });
		await User.rebuildTree(michael, 1);
		const kelly = await User.findOne({ username: 'kelly' });
		assert.ok(michael.isAncestorOf(kelly));
		assert.ok(!kelly.isAncestorOf(michael));
	});

	it('pre save middleware should not set lft and rgt if there is no [parentFieldName]', async () => {
		let user = new User({
			username: 'joe'
		});

		const joe = await user.save();
		assert.equal('joe', joe.username);
		assert.ok(!joe.lft);
		assert.ok(!joe.rgt);

		await user.remove(); // Remove user after assertion

	});

	it('adding a new node to a built tree should re-arrange the tree correctly', async () => {
		const michael = await User.findOne({ username: 'michael' });
		await User.rebuildTree(michael, 1);
		const creed = await User.findOne({ username: 'creed' });
		//console.log(creed);
		let newUser = new User({
			username: 'joe',
			[parentFieldName]: creed[idFieldName]
		});
		await newUser.save();
		const users = await User.find({});
		// see docs/test_tree_after_leaf_insertion.png for the graphical representation of this tree
		// with lft/rgt values after the insertion
		users.forEach(function (person) {
			if (person.username === 'michael') {
				assert.equal(1, person.lft);
				assert.equal(22, person.rgt);
			} else if (person.username === 'meredith') {
				assert.equal(2, person.lft);
				assert.equal(9, person.rgt);
			} else if (person.username === 'jim') {
				assert.equal(10, person.lft);
				assert.equal(17, person.rgt);
			} else if (person.username === 'angela') {
				assert.equal(18, person.lft);
				assert.equal(21, person.rgt);
			} else if (person.username === 'kelly') {
				assert.equal(3, person.lft);
				assert.equal(4, person.rgt);
			} else if (person.username === 'creed') {
				assert.equal(5, person.lft);
				assert.equal(8, person.rgt);
			} else if (person.username === 'phyllis') {
				assert.equal(11, person.lft);
				assert.equal(12, person.rgt);
			} else if (person.username === 'stanley') {
				assert.equal(13, person.lft);
				assert.equal(14, person.rgt);
			} else if (person.username === 'dwight') {
				assert.equal(15, person.lft);
				assert.equal(16, person.rgt);
			} else if (person.username === 'oscar') {
				assert.equal(19, person.lft);
				assert.equal(20, person.rgt);
			} else if (person.username === 'joe') {
				assert.equal(6, person.lft);
				assert.equal(7, person.rgt);
			}
		});

		await newUser.remove(); // Remove user after assertion
	});

	it('removing a node to a built tree should re-arrange the tree correctly', async () => {
		const michael = await User.findOne({ username: 'michael' });
		await User.rebuildTree(michael, 1);
		const creed = await User.findOne({ username: 'creed' });
		await creed.remove();
		const users = await User.find({});
		// see docs/test_tree_after_leaf_insertion.png for the graphical representation of this tree
		// with lft/rgt values after the insertion
		users.forEach(function (person) {
			if (person.username === 'michael') {
				assert.equal(1, person.lft);
				assert.equal(18, person.rgt);
			} else if (person.username === 'meredith') {
				assert.equal(2, person.lft);
				assert.equal(5, person.rgt);
			} else if (person.username === 'jim') {
				assert.equal(6, person.lft);
				assert.equal(13, person.rgt);
			} else if (person.username === 'angela') {
				assert.equal(14, person.lft);
				assert.equal(17, person.rgt);
			} else if (person.username === 'kelly') {
				assert.equal(3, person.lft);
				assert.equal(4, person.rgt);
			} else if (person.username === 'phyllis') {
				assert.equal(7, person.lft);
				assert.equal(8, person.rgt);
			} else if (person.username === 'stanley') {
				assert.equal(9, person.lft);
				assert.equal(10, person.rgt);
			} else if (person.username === 'dwight') {
				assert.equal(11, person.lft);
				assert.equal(12, person.rgt);
			} else if (person.username === 'oscar') {
				assert.equal(15, person.lft);
				assert.equal(16, person.rgt);
			}
		});
	});
});