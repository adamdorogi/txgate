create table txgate_sim (
  ready boolean primary key check (ready)
);
insert into txgate_sim values (true);

create table block (
  id bigserial primary key,
  hash bytea not null unique check (octet_length(hash) = 32),
  previous_id bigint references block(id) on delete cascade,
  block_no integer not null unique check (block_no > 0),
  time timestamptz not null default clock_timestamp()
);

create table tx (
  id bigserial primary key,
  hash bytea not null unique check (octet_length(hash) = 32),
  block_id bigint not null references block(id) on delete cascade,
  valid_contract boolean not null default true
);
create index on tx (block_id);

create table tx_out (
  id bigserial primary key,
  tx_id bigint not null references tx(id) on delete cascade,
  "index" integer not null check ("index" between 0 and 65535),
  address text not null,
  value numeric(20, 0) not null check (value between 0 and 18446744073709551615),
  unique (tx_id, "index")
);
create index on tx_out (address);

create table multi_asset (
  id bigserial primary key,
  policy bytea not null check (octet_length(policy) = 28),
  name bytea not null check (octet_length(name) <= 32),
  unique (policy, name)
);

create table ma_tx_out (
  tx_out_id bigint not null references tx_out(id) on delete cascade,
  ident bigint not null references multi_asset(id),
  quantity numeric(20, 0) not null check (quantity between 1 and 18446744073709551615),
  primary key (tx_out_id, ident)
);

create table tx_in (
  tx_in_id bigint not null references tx(id) on delete cascade,
  tx_out_id bigint not null,
  tx_out_index integer not null,
  foreign key (tx_out_id, tx_out_index) references tx_out(tx_id, "index") on delete cascade,
  primary key (tx_in_id, tx_out_id, tx_out_index)
);
create index on tx_in (tx_out_id, tx_out_index);

create table collateral_tx_in (like tx_in including indexes);
alter table collateral_tx_in add foreign key (tx_in_id) references tx(id) on delete cascade;
alter table collateral_tx_in add foreign key (tx_out_id, tx_out_index) references tx_out(tx_id, "index") on delete cascade;
