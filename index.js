/**
 * Expose `Entity`.
 */
module.exports = Entity;

/**
 * Module dependencies.
 */
var assert = require('assert');
var Normalizer = require('baiji-normalizer');
var meld = require('baiji-meld');
var debug = require('debug')('baiji:entity');

/**
 * @class A wrapper to map returns with object value.
 */
function Entity(object) {
  this._mappings = {};
  this._keys = [];
  var self = this;

  if (object === undefined) return;

  assert(meld.isObject(object), `${object} is not a valid object`);

  var value;
  meld.each(object, function(value, key) {
    value = object[key];
    if (value === true) {
      self.add(key);
    } else if (meld.isArray(value)){
      value.unshift(key);
      self.add.apply(self, value);
    } else {
      self.add.apply(self, [key, value]);
    }
  });
}

/**
 * check whether an object is an Entity instance
 */
Entity.isEntity = function(entity) {
  return !!(entity && meld.isFunction(entity.isEntity) && this.prototype.isEntity.call(entity));
};

Entity.prototype.isEntity = function(entity) {
  return this instanceof Entity;
};

/**
 * add a given name with or without corresponding function or value
 * { act: 'alias',
 *   value: 'name',
 *   default: null,
 *   using: MyEntity,
 *   if: function(obj, opts) {}
 * }
 * type: support array type
 *    number or ['number']
 *    date or ['date']
 *    string or ['string']
 *    boolean or ['boolean']
 *    any (default) or ['any']
 * act:
 *    function
 *    alias
 *    value
 * Usage:
 *    var entity = new Entity();
 *    entity.add('name');
 *    entity.add('name', { as: 'fullname' });
 *    entity.add('name', { type: 'string', as: 'fullname' });
 *    entity.add('sex', { value: 'male' });
 *    entity.add('isAdult', function(obj) { return obj && obj.age >= 18; });
 *    entity.add('activities', { using: myActivityEntity });
 *    entity.add('extraInfo', { using: myExtraInfoEntity });
 *    entity.add('condition', { if: function(obj, options) { return true } });
 */
Entity.prototype.add = function() {
  var fields = Array.prototype.slice.call(arguments);
  assert(fields.length !== 0, 'fields should be provided');

  var self = this;

  var options = {};
  var fn;

  if (fields.length > 1) {
    // extract `fn`
    if (meld.isFunction(fields[fields.length - 1])) {
      fn = Array.prototype.pop.call(fields);
    }

    // extract `options`
    if (meld.isObject(fields[fields.length - 1])) {
      var last = Array.prototype.pop.call(fields);
      var names = Object.getOwnPropertyNames(last);
      Object.assign(options, last);
    }

    if (fields.length > 1) {
      assert(!options.as, 'using :as option on multi-fields exposure not allowed');
      assert(!fn, 'using function on multi-attribute exposure not allowed');
    }
  }

  meld.each(fields, function(field) {
    var value = null;
    var defaultVal = null;
    var act = null;
    var type = null;
    var using = null;
    var ifFn = null;

    assert(meld.isString(field) && /^[a-zA-Z0-9_]+$/g.test(field), `field ${field} must be a string`);
    assert(!(options.as && fn), 'using :as option with function not allowed');
    assert(!(options.value && fn), 'using :value option with function not allowed');
    assert(!(options.value && options.as), 'using :value option with :as option not allowed');

    if (meld.isArray(options.type)) {
      type = [options.type[0] || 'any'];
    } else {
      type = options.type || 'any';
    }

    defaultVal = options.default || null;

    if (options.if) {
      assert(meld.isFunction(options.if), 'if condition must be a function');
      ifFn = options.if;
    }

    if (options.using) {
      assert(Entity.isEntity(options.using), 'using must be an Entity');
      using = options.using;
    }

    if (options.as) {
      assert(meld.isString(options.as), 'as must be a String');
    }

    if (options.as) {
      act = 'alias';
      value = field;
      field = options.as;
    } else if (options.value) {
      act = 'value';
      value = options.value;
    } else if (fn) {
      act = 'function';
      value = fn;
    } else {
      act ='alias';
      value = field;
    }

    self._mappings[field] = {
      type: type,
      act: act,
      value: value,
      default: defaultVal,
      if: ifFn,
      using: using
    };
  });

  self._keys = Object.keys(self._mappings);
};

/**
 * Entity.prototype.add alias
 */
Entity.prototype.expose = Entity.prototype.add;

/**
 * parse a obj object with mappings
 * @param {Object} obj: obj object values
 * @param {Function} converter: value converter, which can accept one parameter
 */
Entity.prototype.parse = function(obj, options, converter) {
  debug('parsing %j with options %j and converter', obj, options);

  var originalObj;
  var result = {};
  var self = this;

  originalObj = meld.isNullOrUndefined(obj) ? {} : obj;

  if (meld.isFunction(options)) {
    converter = options;
  }

  if (!meld.isObject(options)) {
    options = {};
  }

  if (meld.isArray(originalObj)) {
    // if obj is an Array, then loop it
    result = originalObj.map(function(obj) {
      return self.parse(obj, options, converter);
    });
    return result;
  } else {
    if (self._keys.length === 0) {
      // if no exposes, return
      return result;
    } else {
      meld.each(self._keys, function(key) {
        var o = self._mappings[key];
        var val = null;

        if (o.if && !o.if(originalObj, options)) {
          return;
        }

        switch(o.act){
          case 'function':
            try {
              val = o.value(originalObj, options);
            } catch(err) {
              debug('[ERROR] -> ', err);
              val = null;
            }
            break;
          case 'alias':
            val = originalObj[o.value];
            break;
          case 'value':
            val = o.value;
            break;
        }

        var isDefaultValueApplied = false;
        // if value is `null`, `undefined`, set default value
        if (meld.isNullOrUndefined(val)) {
          val = o.default;
          isDefaultValueApplied = true;
        }

        if (converter && meld.isFunction(converter)) {
          val = converter(val, options);
        }

        if (!isDefaultValueApplied && o.using) {
          val = o.using.parse(val, options, converter);
        }

        // cast type according to predefined dynamic converters
        try {
          val = Normalizer.convert(val, o.type, options);
        } catch (err) {
          debug('[ERROR] -> ', err);
        }

        result[key] = val;
      });

      return result;
    }
  }
};
