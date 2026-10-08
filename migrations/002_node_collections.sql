CREATE TABLE node_collections(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, remark TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL CHECK(position>=0), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE node_collection_members(collection_id INTEGER NOT NULL REFERENCES node_collections(id) ON DELETE CASCADE, node_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE, created_at TEXT NOT NULL, PRIMARY KEY(collection_id,node_id));
CREATE INDEX collection_node_lookup ON node_collection_members(node_id);
