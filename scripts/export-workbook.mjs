// Run with the bundled artifact-tool runtime, outside the web request process.
import fs from 'node:fs/promises';
import {Workbook,SpreadsheetFile} from '@oai/artifact-tool';
const [input,output,previewDir]=process.argv.slice(2);
const data=JSON.parse(await fs.readFile(input,'utf8'));
const book=Workbook.create();
const dateFields=new Set(['occurred','received','started','ended','first_visit','last_visit','last_seen','created']);
for(const [name,table] of Object.entries(data.tables)){
  const sheet=book.worksheets.add(name);
  sheet.showGridLines=false;
  const columns=table.columns;
  const values=[columns,...table.rows.map(row=>columns.map(key=>{
    const value=row[key] ?? null;
    // Store literal user text, never executable spreadsheet formulas.
    return typeof value==='string'&&value.startsWith('=')?"'"+value:value;
  }))];
  sheet.getRangeByIndexes(0,0,values.length,columns.length).values=values;
  const used=sheet.getRangeByIndexes(0,0,values.length,columns.length);
  used.format.font={name:'Arial',size:11};used.format.columnWidth=24;used.format.rowHeight=22;
  sheet.getRangeByIndexes(0,0,1,columns.length).format={fill:'#203652',font:{bold:true,color:'#FFFFFF'},rowHeight:30};
  for(let i=0;i<columns.length;i++){
    const key=columns[i];
    if(key.endsWith('_id'))sheet.getRangeByIndexes(0,i,values.length,1).format.columnWidth=42;
    if(dateFields.has(key)){
      // Numeric Unix seconds are preserved exactly for auditability. UTC label is explicit.
      sheet.getRangeByIndexes(0,i,1,1).values=[[key+' (Unix seconds UTC)']];
      sheet.getRangeByIndexes(0,i,values.length,1).format.columnWidth=32;
      if(values.length>1)sheet.getRangeByIndexes(1,i,values.length-1,1).setNumberFormat('0.000');
    }
    if(key==='progress'&&values.length>1)sheet.getRangeByIndexes(1,i,values.length-1,1).setNumberFormat('0.0%');
    if(key.endsWith('_utc')){
      sheet.getRangeByIndexes(0,i,values.length,1).format.columnWidth=30;
      if(values.length>1)sheet.getRangeByIndexes(1,i,values.length-1,1).setNumberFormat('yyyy-mm-dd hh:mm:ss "UTC"');
    }
  }
  sheet.freezePanes.freezeRows(1);
}
book.recalculate();
const errors=await book.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?',options:{useRegex:true,maxResults:10}});
if(previewDir){
  await fs.mkdir(previewDir,{recursive:true});
  for(const name of Object.keys(data.tables)){
    const preview=await book.render({sheetName:name,range:'A1:D8',scale:1,format:'png'});
    await fs.writeFile(`${previewDir}/${name}.png`,new Uint8Array(await preview.arrayBuffer()));
  }
  console.log((await book.inspect({kind:'table',range:'Summary!A1:B8',include:'values,formulas',tableMaxRows:8,tableMaxCols:2})).ndjson);
  console.log(errors.ndjson);
}
const file=await SpreadsheetFile.exportXlsx(book);await file.save(output);
