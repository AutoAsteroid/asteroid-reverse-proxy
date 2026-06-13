
const fs = require("fs");

class DisjointSet {
    /**
     * Basic disjoint set implementation by rank and tracking states for clusters
     * Supports loading and saving snapshots of DSUs into JSON files for backup
     */
    constructor() {
        this.parent = new Map();
        this.rank = new Map();
        this.clusters = new Map();
    }

    /**
     * Initializes a new unique identity node within the disjoint set
     * @param {any} x The unique identifier to register 
     */
    makeSet(x) {
        if (this.parent.has(x)) return;

        this.parent.set(x, x);
        this.rank.set(x, 0);
        this.clusters.set(x, [x]);
    }

    /**
     * Locate the absolute root identifier in a given identity group
     * @param {any} x The identity to look up in the disjoint set
     * @returns {any} The absolute root identifier of the cluster
     */
    find(x) {
        if (!this.parent.has(x))
            this.makeSet(x);

        // Path compression to point nodes directly to the root
        if (this.parent.get(x) !== x)
            this.parent.set(x, this.find(this.parent.get(x)));

        return this.parent.get(x);
    }
 
    /**
     * Unions two separate identities or tracking networks together
     * Dynamically merges flat arrays and updates tracking maps
     * @param {any} x First identity link
     * @param {any} y Second identity link
     */
    union(x, y) {
        let rootX = this.find(x);
        let rootY = this.find(y);
        if (rootX === rootY) return;

        // Swap roots if necessary so rootX always points to the higher rank tree
        if (this.rank.get(rootX) < this.rank.get(rootY))
            [rootX, rootY] = [rootY, rootX];

        // Attach rootY under rootX's tree since it is always the smaller tree
        this.parent.set(rootY, rootX);
        this.clusters.get(rootX).push(...this.clusters.get(rootY));
        this.clusters.delete(rootY);

        // Increment rootX's rank if equal since rootY was attached beneath it
        if (this.rank.get(rootX) === this.rank.get(rootY))
            this.rank.set(rootX, this.rank.get(rootX) + 1);
    }

    /**
     * Fetches all registered elements associated with the given set
     * @param {any} element A given element linked to any given union cluster
     * @returns {Array<any>} An array containing all linked elements
     */
    getCluster(element) {
        const root = this.find(element);
        const elements = this.clusters.get(root);
        return elements ? [...elements] : [];
    }

    /**
     * Exports the current state of the disjoint set's clusters to a file
     * @param {string} file The file path to save the DSU clusters in json
     */
    saveToFile(file) {
        const exportObject = Object.fromEntries(this.clusters);
        const jsonString = JSON.stringify(exportObject, null, 4)
        fs.writeFileSync(file, jsonString, "utf8");
    }

    /**
     * Rebuilds the DSU structure from a previously saved file of its clusters
     * @param {string} file The file path of the clusters created by saveToFile()
     * @returns {DisjointSet} The new populated Disjoint Set that was overwritten
     */
    loadFromFile(file) {
        const rawData = fs.readFileSync(file, "utf8");
        const clusters = JSON.parse(rawData);

        // Clear any existing tracking states in memory before rebuilding
        this.parent.clear();
        this.rank.clear();
        this.clusters.clear();

        // Loop through each cluster group and union them back together
        for (const [root, elements] of Object.entries(clusters)) {
            this.makeSet(root);
            
            for (const element of elements)
                this.union(root, element);
        }
        return this;
    }
}

module.exports = DisjointSet;