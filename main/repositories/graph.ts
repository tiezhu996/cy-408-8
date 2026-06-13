import { GraphNode } from '../../shared/types/entities';
import { getDatabase } from '../database';

export class GraphRepository {
  list(): GraphNode[] {
    return getDatabase().prepare('SELECT * FROM graph_nodes').all().map((row: any) => ({
      ...row,
      relatedContactIds: JSON.parse(row.relatedContactIds || '[]').filter((id: string) => id !== row.contactId)
    }));
  }

  save(node: GraphNode): GraphNode {
    getDatabase()
      .prepare('INSERT OR REPLACE INTO graph_nodes VALUES (@id,@contactId,@relatedContactIds,@strength,@notes)')
      .run({ ...node, relatedContactIds: JSON.stringify(node.relatedContactIds) });
    return node;
  }
}
