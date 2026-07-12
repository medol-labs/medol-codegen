create sequence if not exists "aggregate-event-global-index-sequence" start with 1 increment by 1;

create table if not exists aggregate_event_entry
(
    global_index              bigint       not null,
    aggregate_type            varchar(255),
    aggregate_identifier      varchar(255),
    aggregate_sequence_number bigint,
    type                      varchar(255) not null,
    version                   varchar(255) not null,
    timestamp                 varchar(255) not null,
    payload                   oid          not null,
    metadata                  oid,
    identifier                varchar(255) not null,
    primary key (global_index),
    unique (aggregate_identifier, aggregate_sequence_number)
);

create table if not exists token_entry
(
    processor_name varchar(255) not null,
    segment        integer      not null,
    mask           integer      not null,
    owner          varchar(255),
    timestamp      varchar(255) not null,
    token_type     varchar(255),
    token          oid,
    primary key (processor_name, segment)
);
