CREATE TABLE subscription_local_nodes(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subscription_id INTEGER NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  remark TEXT NOT NULL DEFAULT '',
  protocol TEXT NOT NULL,
  original_uri TEXT NOT NULL,
  normalized_config TEXT NOT NULL CHECK(json_valid(normalized_config)),
  unknown_params TEXT NOT NULL CHECK(json_valid(unknown_params)),
  parser_name TEXT NOT NULL,
  parser_version TEXT NOT NULL,
  parse_warnings TEXT NOT NULL CHECK(json_valid(parse_warnings)),
  unsupported_fields TEXT NOT NULL CHECK(json_valid(unsupported_fields)),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN(0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(subscription_id,id)
);
CREATE INDEX subscription_local_nodes_subscription ON subscription_local_nodes(subscription_id);

CREATE TABLE subscription_entries(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subscription_id INTEGER NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK(source_type IN('global','local')),
  node_id INTEGER REFERENCES nodes(id) ON DELETE CASCADE,
  local_node_id INTEGER,
  position INTEGER NOT NULL CHECK(position>=0),
  created_at TEXT NOT NULL,
  CHECK(
    (source_type='global' AND node_id IS NOT NULL AND local_node_id IS NULL) OR
    (source_type='local' AND node_id IS NULL AND local_node_id IS NOT NULL)
  ),
  UNIQUE(subscription_id,position),
  UNIQUE(subscription_id,node_id),
  UNIQUE(subscription_id,local_node_id),
  FOREIGN KEY(subscription_id,local_node_id)
    REFERENCES subscription_local_nodes(subscription_id,id) ON DELETE CASCADE
);
CREATE INDEX subscription_entries_node ON subscription_entries(node_id);
CREATE INDEX subscription_entries_local_node ON subscription_entries(local_node_id);

INSERT INTO subscription_entries(
  subscription_id,source_type,node_id,local_node_id,position,created_at
)
SELECT subscription_id,'global',node_id,NULL,position,created_at
FROM subscription_nodes
ORDER BY subscription_id,position;
