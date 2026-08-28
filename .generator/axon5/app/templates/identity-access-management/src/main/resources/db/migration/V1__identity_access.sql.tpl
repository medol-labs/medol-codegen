create table if not exists app_user (
    id uuid primary key,
    provider_subject varchar(255) unique,
    username varchar(255) not null unique,
    password_hash varchar(255),
    organization_id uuid,
    active boolean not null default true
);

create table if not exists app_role (
    code varchar(100) primary key,
    name varchar(255) not null
);

create table if not exists app_permission (
    code varchar(150) primary key,
    description varchar(255)
);

create table if not exists app_user_role (
    user_id uuid not null references app_user(id),
    role_code varchar(100) not null references app_role(code),
    primary key (user_id, role_code)
);

create table if not exists app_role_permission (
    role_code varchar(100) not null references app_role(code),
    permission_code varchar(150) not null references app_permission(code),
    primary key (role_code, permission_code)
);

insert into app_role(code, name)
values
    ('ADMIN', 'Administrator')<% for (const actor of security.actors) { %>,
    ('<%= actor.roleCode %>', '<%= actor.title.replace(/'/g, "''") %>')<% } %>
on conflict (code) do nothing;

insert into app_permission(code, description)
values
    ('*:*', 'All permissions')<% for (const permission of security.permissions.filter((item) => item.code !== '*:*')) { %>,
    ('<%= permission.code.replace(/'/g, "''") %>', '<%= permission.description.replace(/'/g, "''") %>')<% } %>
on conflict (code) do nothing;

insert into app_role_permission(role_code, permission_code)
values ('ADMIN', '*:*')
on conflict (role_code, permission_code) do nothing;
<% if (security.grants.length > 0) { %>

insert into app_role_permission(role_code, permission_code)
values<% security.grants.forEach((grant, index) => { %>
    ('<%= grant.roleCode %>', '<%= grant.permissionCode.replace(/'/g, "''") %>')<%= index + 1 === security.grants.length ? '' : ',' %><% }) %>
on conflict (role_code, permission_code) do nothing;
<% } %>

insert into app_user(id, provider_subject, username, password_hash, organization_id, active)
values (
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'admin',
    '{noop}admin',
    null,
    true
)
on conflict (id) do nothing;

insert into app_user_role(user_id, role_code)
values ('00000000-0000-0000-0000-000000000001', 'ADMIN')
on conflict (user_id, role_code) do nothing;
