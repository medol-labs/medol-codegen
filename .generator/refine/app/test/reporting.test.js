const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ejs=require('ejs');
const {buildFrontendModel}=require('../model-builder');
test('report workspace is only attached to the imported reporting definition and targets its owning backend',()=>{
 const source={domain:'Demo',reporting:{context:'Reporting'},slices:[{id:'reports',title:'Reports',context:'Reporting',commands:[],events:[],readmodels:[{id:'definitions',title:'ReportDefinitionCatalog',listElement:true,fields:[{name:'reportVersionId',type:'UUID',idAttribute:true}]}]}]};
 const resource=buildFrontendModel(source).resources[0];assert.equal(resource.reporting,true);
 const render=r=>ejs.render(fs.readFileSync(path.join(__dirname,'../templates/src/pages/show.tsx.tpl'),'utf8'),{resource:r});
 const result=render(resource);assert.match(result,/ReportPanel/);assert(result.includes(`backendModuleName="${resource.moduleName}"`));
 delete source.reporting;assert(!render(buildFrontendModel(source).resources[0]).includes('ReportPanel'));
});

test('reporting UI copy has contextual Chinese translations',()=>{
 const model=buildFrontendModel({domain:'Demo',locales:['zh-CN'],defaultLocale:'zh-CN',slices:[]});
 assert.equal(model.i18n.messages['zh-CN']['reporting.workspace'],'报表查询与导出');
 assert.equal(model.i18n.messages['zh-CN']['reporting.states.Requested'],'等待执行');
});
