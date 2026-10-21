CREATE TABLE node_groups(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(trim(name)) BETWEEN 1 AND 100), position INTEGER NOT NULL UNIQUE CHECK(position>=0), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
ALTER TABLE nodes ADD COLUMN group_id INTEGER REFERENCES node_groups(id) ON DELETE RESTRICT;
CREATE INDEX nodes_group ON nodes(group_id,id);
INSERT INTO node_groups(name,position,created_at,updated_at)
SELECT '原节点库',0,datetime('now'),datetime('now')
WHERE EXISTS(SELECT 1 FROM nodes);
UPDATE nodes SET group_id=(SELECT id FROM node_groups WHERE name='原节点库')
WHERE group_id IS NULL AND EXISTS(SELECT 1 FROM node_groups WHERE name='原节点库');
CREATE TRIGGER nodes_require_group_insert BEFORE INSERT ON nodes
WHEN NEW.group_id IS NULL OR NOT EXISTS(SELECT 1 FROM node_groups WHERE id=NEW.group_id)
BEGIN SELECT RAISE(ABORT,'Global Node must belong to exactly one Node Group'); END;
CREATE TRIGGER nodes_require_group_update BEFORE UPDATE OF group_id ON nodes
WHEN NEW.group_id IS NULL OR NOT EXISTS(SELECT 1 FROM node_groups WHERE id=NEW.group_id)
BEGIN SELECT RAISE(ABORT,'Global Node must belong to exactly one Node Group'); END;
CREATE TRIGGER node_groups_delete_empty BEFORE DELETE ON node_groups
WHEN EXISTS(SELECT 1 FROM nodes WHERE group_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'Node Group must be empty before deletion'); END;
