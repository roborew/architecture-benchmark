import { pgTable, bigint, text, timestamp, index, foreignKey, primaryKey, check } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"



export const comments = pgTable("comments", {
	id: bigint({ mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
	taskId: bigint("task_id", { mode: 'number' }).notNull().references(() => tasks.id, { onDelete: "cascade" } ),
	authorId: bigint("author_id", { mode: 'number' }).notNull().references(() => users.id, { onDelete: "restrict" } ),
	body: text().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => [
	index("comments_author_id_idx").using("btree", table.authorId.asc().nullsLast()),
	index("comments_task_created_id_idx").using("btree", table.taskId.asc().nullsLast(), table.createdAt.desc().nullsFirst(), table.id.desc().nullsFirst()),
check("comments_body_check", sql`((char_length(body) >= 1) AND (char_length(body) <= 1000))`),]);

export const projects = pgTable("projects", {
	id: bigint({ mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
	name: text().notNull(),
	description: text().default("").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const tasks = pgTable("tasks", {
	id: bigint({ mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
	projectId: bigint("project_id", { mode: 'number' }).notNull().references(() => projects.id, { onDelete: "restrict" } ),
	assigneeId: bigint("assignee_id", { mode: 'number' }).references(() => users.id, { onDelete: "set null" } ),
	title: text().notNull(),
	description: text().default("").notNull(),
	status: text().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (table) => [
	index("tasks_assignee_id_idx").using("btree", table.assigneeId.asc().nullsLast()),
	index("tasks_project_created_id_idx").using("btree", table.projectId.asc().nullsLast(), table.createdAt.desc().nullsFirst(), table.id.desc().nullsFirst()),
	index("tasks_project_status_created_id_idx").using("btree", table.projectId.asc().nullsLast(), table.status.asc().nullsLast(), table.createdAt.desc().nullsFirst(), table.id.desc().nullsFirst()),
check("tasks_status_check", sql`(status = ANY (ARRAY['todo'::text, 'in progress'::text, 'done'::text]))`),check("tasks_title_check", sql`((char_length(title) >= 1) AND (char_length(title) <= 200))`),]);

export const users = pgTable("users", {
	id: bigint({ mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
	displayName: text("display_name").notNull(),
	email: text().notNull(),
});
