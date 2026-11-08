const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');
const {buildFrontendModel} = require('../model-builder');

test('document downloads require explicit builtin metadata and use owning backend', () => {
 const source = {domain:'Demo', documentGeneration:{context:'DocumentGeneration'},
  slices:[{id:'documents',title:'Documents',context:'DocumentGeneration',commands:[],events:[],
   readmodels:[{id:'catalog',title:'GeneratedDocumentCatalog',listElement:true,fields:[
    {name:'documentId',type:'UUID',idAttribute:true},{name:'state',type:'String'}]}]}]};
 const resource=buildFrontendModel(source).resources[0];
 assert.equal(resource.artifactDownload.suffix,'/file');
 for(const page of ['list','show']) {
  const result=ejs.render(fs.readFileSync(path.join(__dirname,`../templates/src/pages/${page}.tsx.tpl`),'utf8'),{resource});
  assert.match(result,/DownloadFileButton/);assert.match(result,/encodeURIComponent/);
  assert.match(result,/!== "Completed"/);
  assert(result.includes(`backendModuleName="${resource.moduleName}"`));
 }
 delete source.documentGeneration;
 assert.equal(buildFrontendModel(source).resources[0].artifactDownload,undefined);
});
