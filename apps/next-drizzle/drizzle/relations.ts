import { defineRelations } from "drizzle-orm";
import * as schema from "./schema";

export const relations = defineRelations(schema, (r) => ({
	users: {
		tasks: r.many.tasks({
			from: r.users.id.through(r.comments.authorId),
			to: r.tasks.id.through(r.comments.taskId)
		}),
		projects: r.many.projects({
			from: r.users.id.through(r.tasks.assigneeId),
			to: r.projects.id.through(r.tasks.projectId)
		}),
	},
	tasks: {
		users: r.many.users(),
	},
	projects: {
		users: r.many.users(),
	},
}))