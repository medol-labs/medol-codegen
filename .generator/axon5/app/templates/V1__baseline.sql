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
