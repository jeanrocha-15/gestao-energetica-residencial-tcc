import { sqliteTable, text, real, integer, uniqueIndex, primaryKey, index, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import type { TariffConfig } from '@/lib/tariffs';

// Tokens OAuth ficam cifrados; o UID é obtido da autorização e nunca solicitado ao usuário final.
export const tuyaOauthAccounts = sqliteTable('tuya_oauth_accounts', {
  userId:text('user_id').primaryKey(), accountKey:text('account_key').notNull().unique(),
  appUid:text('app_uid').notNull(), tokens:text('tokens').notNull(), expiresAt:integer('expires_at').notNull(),
});
// A autorização temporária é vinculada à sessão local e consumida uma única vez.
export const tuyaOauthStates = sqliteTable('tuya_oauth_states', {
  stateHash:text('state_hash').primaryKey(), userId:text('user_id').notNull(),
  sessionHash:text('session_hash').notNull(), expiresAt:integer('expires_at').notNull(),
});
// Agenda e resultado persistem entre reinícios, separando tentativa de atualização bem-sucedida.
export const tuyaSyncState = sqliteTable('tuya_sync_state', {
  userId:text('user_id').primaryKey(), nextRunAt:integer('next_run_at').notNull().default(0),
  lastAttemptAt:integer('last_attempt_at'), lastSuccessAt:integer('last_success_at'),
  status:text('status').notNull().default('pending'), message:text('message').notNull().default('Aguardando coleta.'),
});

// O vínculo local guarda apenas a identidade da conta, nunca o token ou segredo do provedor.
export const tuyaConnections = sqliteTable('tuya_connections', {
  userId: text('user_id').primaryKey(), accountKey: text('account_key').notNull(),
  connectedAt: text('connected_at').notNull(),
});
// Associações reais são independentes do cadastro genérico e preservam a divisão por usuário.
export const tuyaMappings = sqliteTable('tuya_mappings', {
  userId: text('user_id').notNull(), deviceId: text('device_id').notNull(), accountKey: text('account_key').notNull(),
  room: text('room').notNull(), circuit: text('circuit').notNull(), energyCode: text('energy_code'),
  energyMode: text('energy_mode').notNull(), since: integer('since').notNull(), lastLogAt: integer('last_log_at').notNull().default(0),
}, table => [primaryKey({ columns:[table.userId, table.deviceId] })]);
// Cada evento incremental real só pode contribuir uma vez para o dashboard.
export const tuyaEnergyEvents = sqliteTable('tuya_energy_events', {
  userId: text('user_id').notNull(), deviceId: text('device_id').notNull(), eventKey: text('event_key').notNull(),
  date: text('date').notNull(), room: text('room').notNull(), circuit: text('circuit').notNull(),
  kwh: real('kwh').notNull(), eventTime: integer('event_time').notNull(),
}, table => [primaryKey({ columns:[table.userId, table.deviceId, table.eventKey] })]);

// Cadastro por usuário, independente do fabricante; cadastrar não estabelece uma conexão.
export const devices = sqliteTable('devices', {
  id: text('id').primaryKey(), userId: text('user_id').notNull(),
  name: text('name').notNull(), manufacturer: text('manufacturer').notNull(),
  model: text('model').notNull(), room: text('room').notNull(), circuit: text('circuit').notNull(),
  identifier: text('identifier').notNull(), dataSource: text('data_source').notNull(),
  integrationStatus: text('integration_status').notNull().default('Integração não configurada'),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
});

// Cada configuração contém tarifa e bandeira com a mesma vigência inclusiva, por usuário.
export const tariffs = sqliteTable('tariffs', {
  id: text('id').primaryKey(), userId: text('user_id').notNull(),
  startDate: text('start_date').notNull(), endDate: text('end_date').notNull(),
  config: text('config', { mode: 'json' }).$type<TariffConfig>().notNull(),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
// Índice acelera consultas; a restrição rejeita vigências invertidas.
}, table => [index('idx_tariffs_user_period').on(table.userId, table.startDate, table.endDate), check('tariffs_period_order', sql`${table.startDate} <= ${table.endDate}`)]);
// Apenas hashes de senha e de sessão são persistidos; nenhum segredo vai para o HTML.
export const localUsers = sqliteTable('local_users', {
  id: text('id').primaryKey(), email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(), salt: text('salt').notNull(),
});
export const localSessions = sqliteTable('local_sessions', {
  tokenHash: text('token_hash').primaryKey(), userId: text('user_id').notNull().references(() => localUsers.id),
  expiresAt: integer('expires_at').notNull(),
});
export const readings = sqliteTable('readings', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  date: text('date').notNull(),
  room: text('room').notNull(),
  circuit: text('circuit').notNull(),
  kwh: real('kwh').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, table => [
  uniqueIndex('idx_readings_user_date_room_circuit').on(table.userId, table.date, table.room, table.circuit),
]);

// Guarda a última referência de cada contador para calcular somente energia nova.
export const tuyaCounters = sqliteTable('tuya_counters', {
  userId: text('user_id').notNull(), deviceId: text('device_id').notNull(),
  total: real('total').notNull(), date: text('date').notNull(),
  mapping: text('mapping').notNull(), checkedAt: text('checked_at').notNull(),
}, table => [primaryKey({ columns: [table.userId, table.deviceId] })]);

// Acumula os intervalos monitorados por dispositivo e dia sem alterar registros manuais.
export const tuyaReadings = sqliteTable('tuya_readings', {
  id: text('id').primaryKey(), userId: text('user_id').notNull(), deviceId: text('device_id').notNull(),
  date: text('date').notNull(), room: text('room').notNull(), circuit: text('circuit').notNull(), kwh: real('kwh').notNull(),
}, table => [uniqueIndex('idx_tuya_daily').on(table.userId, table.deviceId, table.date, table.room, table.circuit)]);

// Reserva a sincronização por usuário para evitar duplicidade entre requisições concorrentes.
export const tuyaLocks = sqliteTable('tuya_locks', {
  userId: text('user_id').primaryKey(), token: text('token').notNull(), expiresAt: integer('expires_at').notNull(),
});
