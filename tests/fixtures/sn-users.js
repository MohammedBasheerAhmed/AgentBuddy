// People used across the fixtures: sys_user rows as the Table API returns them (display_value=false for the sys_user
// read the pack makes), and the ids the other fixtures refer to.

export const ABEL = { sysId: 'a8f98bb0eb32010045e1a5115206fe3a', name: 'Abel Tuter', login: 'abel.tuter', email: 'abel.tuter@example.com' };
export const BETH = { sysId: '46d44a23a9fe19810012d100cca80666', name: 'Beth Anglin', login: 'beth.anglin', email: 'beth.anglin@example.com' };
export const MARIA = { sysId: '5137153cc611227c000bbd1bd8cd2005', name: "María-José O'Neil", login: 'maria.oneil', email: 'maria.oneil@example.com' };
export const CHARLIE = { sysId: '62826bf03710200044e0bfc8bcbe5df1', name: 'Charlie Whitherspoon', login: 'charlie.whitherspoon', email: 'charlie.w@example.com' };
export const DAVE = { sysId: '77ad8c0d3b4b4f0d8d8e0cb8d3e2a001', name: 'Dave Loftus', login: 'dave.loftus', email: 'dave.loftus@example.com' };
export const ERIN = { sysId: '8e9b1d2c3f4a4b5c8d6e7f8091a2b3c4', name: 'Erin Contact', login: 'erin.contact', email: 'erin@acme.example.com' };
export const JANE = { sysId: 'b1c2d3e4f5a64b7c8d9e0f1a2b3c4d5e', name: 'Jane Doe', login: 'jane.doe', email: 'jane.doe@example.com' };
export const HANA = { sysId: 'c2d3e4f5a6b74c8d9e0f1a2b3c4d5e6f', name: 'Hana Rivera', login: 'hana.rivera', email: 'hana.rivera@example.com' };

const userRow = (u, extra = {}) => {
  const [first, ...rest] = u.name.split(' ');
  return { sys_id: u.sysId, user_name: u.login, name: u.name, email: u.email, first_name: first, last_name: rest.join(' '), ...extra };
};

/** sys_user rows (plus a few columns that must never be asked for). */
export function userRows() {
  return [ABEL, BETH, MARIA, CHARLIE, DAVE, ERIN, JANE, HANA].map((u) => userRow(u, { phone: '+1 555-0100', mobile_phone: '+1 555-0111', title: 'Staff', u_badge: 'B-1234' }));
}
