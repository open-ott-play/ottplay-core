(function (host) {
    "use strict";
    var factories = {}, instances = {}, resolving = {}, has = Object.prototype.hasOwnProperty;
    function require(name) {
        var key = "$" + name;
        if (has.call(instances, key)) return instances[key];
        if (!has.call(factories, key)) throw new Error("Missing module: " + name);
        if (resolving[key]) throw new Error("Circular dependency: " + name);
        resolving[key] = true;
        try { instances[key] = factories[key](require); }
        finally { delete resolving[key]; }
        return instances[key];
    }
    host.OTT2 = {
        define: function (name, factory) {
            if (has.call(factories, "$" + name)) throw new Error("Duplicate module: " + name);
            factories["$" + name] = factory;
        },
        require: require
    };
})(typeof window !== "undefined" ? window : this);
