import { test, expect } from '@playwright/test';
import { newGame, owned, beginAttack, beginFortify, endTurn, attack } from '../engine.js';
import { EDGES, SYSTEMS } from '../map-data.js';
const KEY='eve-warfront-campaign-v1';
async function install(page,state){await page.addInitScript(({key,state})=>localStorage.setItem(key,JSON.stringify(state)),{key:KEY,state});await page.goto('/');}
async function current(page){return page.evaluate(key=>JSON.parse(localStorage.getItem(key)),KEY);}

test('enlist, reinforce, advance phases, pause bots and resume a saved campaign',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await expect(page.locator('#setup-dialog')).toBeVisible();
  await page.locator('#callsign').fill('Test Commander');await page.locator('[name=faction][value=gallente]').check();
  await page.getByRole('button',{name:'Deploy to the warzone'}).click();
  let s=await current(page);expect(s.players[0].faction).toBe('gallente');expect(s.players[0].name).toBe('Test Commander');
  await expect(page.locator('#map-systems .system')).toHaveCount(90);
  const system=owned(s)[0];await page.locator(`#map-systems [data-system="${system}"]`).click();
  await page.getByRole('button',{name:'Deploy fleets',exact:true}).click();s=await current(page);expect(s.reserve).toBe(0);
  await page.getByRole('button',{name:'Begin attack phase'}).click();await expect(page.locator('#orders')).toContainText('Push the frontline');
  await page.getByRole('button',{name:'Finish attacks & fortify'}).click();
  await page.locator('#pause-bots').click();await page.getByRole('button',{name:'End turn'}).click();
  s=await current(page);expect(s.current).toBe(1);await page.reload();
  await expect(page.locator('#setup-dialog')).not.toBeVisible();await expect(page.locator('#roster')).toContainText('Test Commander');
  expect(errors).toEqual([]);
});
test('attack, capture, occupancy and saved combat survive reloads',async({page})=>{
  const s=newGame({seed:442,mode:'conquest'}),[a,b]=EDGES[0];s.territories[a]={owner:0,troops:50};s.territories[b]={owner:1,troops:1};s.phase='attack';s.reserve=0;
  await install(page,s);
  await page.locator('#system-search').fill(SYSTEMS[a].name);await page.locator('#system-search').fill('');
  await page.locator(`#intel [data-system="${b}"]`).click();
  await expect(page.locator('#orders')).toContainText('Chance to capture');
  await page.getByRole('button',{name:'Blitz until capture'}).click();
  await expect(page.getByRole('button',{name:'Occupy system'})).toBeVisible();
  await page.getByRole('button',{name:'Occupy system'}).click();
  const saved=await current(page);expect(saved.territories[b].owner).toBe(0);expect(saved.territories[b].troops).toBeGreaterThan(1);
  expect(saved.territories[a].troops).toBe(1);
});
test('pending occupation restores exactly after a browser reload',async({page})=>{
  const s=newGame({seed:94,mode:'conquest'}),[a,b]=EDGES[1];s.phase='attack';s.reserve=0;s.territories[a]={owner:0,troops:70};s.territories[b]={owner:1,troops:1};while(s.phase==='attack')attack(s,a,b,3);
  await install(page,s);await page.reload();await expect(page.getByRole('button',{name:'Occupy system'})).toBeVisible();
  await page.getByRole('button',{name:'Occupy system'}).click();expect((await current(page)).phase).toBe('attack');
});
test('cards are selectable and a forced set can be exchanged',async({page})=>{
  const s=newGame({seed:32});const hand=[0,1,2,3,4];s.players[0].cards=hand;s.deck=s.deck.filter(c=>!hand.includes(c));
  await install(page,s);await page.getByRole('button',{name:'Find set',exact:true}).click();await page.getByRole('button',{name:'Exchange',exact:true}).click();
  const saved=await current(page);expect(saved.players[0].cards.length).toBe(2);expect(saved.trades).toBe(1);expect(saved.reserve).toBe(s.reserve+4);
});
test('bot scheduling pauses while a manual is open and continues to the human',async({page})=>{
  const s=newGame({seed:100});s.reserve=0;beginAttack(s);beginFortify(s);endTurn(s);
  await install(page,s);await page.locator('#pause-bots').click();await page.locator('#bot-speed').selectOption('30');
  await page.getByRole('button',{name:'Field manual'}).click();const before=await current(page);await page.waitForTimeout(300);expect(await current(page)).toEqual(before);
  await page.getByRole('button',{name:'Close field manual'}).click();await page.locator('#pause-bots').click();
  await expect.poll(async()=> (await current(page)).current,{timeout:25000}).toBe(0);
  expect((await current(page)).turn).toBe(5);
});
test('mobile play, keyboard selection, zoom, search and map fit',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/');await page.getByRole('button',{name:'Deploy to the warzone'}).click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const old=await page.locator('#warzone').getAttribute('viewBox');await page.getByRole('button',{name:'Zoom in',exact:true}).click();expect(await page.locator('#warzone').getAttribute('viewBox')).not.toBe(old);
  await page.locator('#system-search').fill('Tama');await expect(page.locator('#intel')).toContainText('Tama');
  await page.locator('#map-group').selectOption('0');expect(await page.locator('#warzone').getAttribute('viewBox')).not.toBe(old);
  await page.getByRole('button',{name:'Fit map',exact:true}).click();expect(await page.locator('#warzone').getAttribute('viewBox')).toBe(old);
  const s=await current(page),i=owned(s)[0];await page.locator('#system-search').fill('');const node=page.locator(`#map-systems [data-system="${i}"]`);await node.focus();await page.keyboard.press('Enter');await expect(page.getByRole('button',{name:'Deploy fleets',exact:true})).toBeVisible();
});
test('mute preference persists and all local audio files decode',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Deploy to the warzone'}).click();await page.getByRole('button',{name:'Mute sound',exact:true}).click();await page.reload();await expect(page.getByRole('button',{name:'Enable sound',exact:true})).toBeVisible();
  const decoded=await page.evaluate(async()=>{
    const context=new AudioContext();const results=[];
    for(const name of ['interface','notification','complete','capacitor','structure','dice-roll','ship-thrust']){const response=await fetch(`assets/sounds/${name}.mp3`);const buffer=await context.decodeAudioData(await response.arrayBuffer());results.push(buffer.duration>0);}
    await context.close();return results;
  });expect(decoded.every(Boolean)).toBe(true);
});
test('export/import restores state and rejects malformed saves',async({page})=>{
  const s=newGame({seed:643,name:'Imported Pilot'});await page.goto('/');await page.getByRole('button',{name:'Deploy to the warzone'}).click();
  await page.locator('#save-file').setInputFiles({name:'campaign.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(s))});
  await expect(page.locator('#roster')).toContainText('Imported Pilot');expect((await current(page)).rng).toBe(s.rng);
  await page.locator('#save-file').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{"broken":true}')});
  await expect(page.locator('#toast')).toContainText('Cannot import');expect((await current(page)).players[0].name).toBe('Imported Pilot');
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export',exact:true}).click();expect((await download).suggestedFilename()).toBe('warfront-campaign.json');
});
test('the static app works under a GitHub Pages project subpath',async({page})=>{
  await page.route('**/eveonline-risk/**',async route=>{
    const url=new URL(route.request().url());url.pathname=url.pathname.replace('/eveonline-risk/','/');
    const response=await route.fetch({url:url.href});await route.fulfill({response});
  });
  await page.goto('/eveonline-risk/');await page.getByRole('button',{name:'Deploy to the warzone'}).click();
  await expect(page.locator('#map-systems .system')).toHaveCount(90);
  expect(await page.locator('.commander img').first().evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);
});
