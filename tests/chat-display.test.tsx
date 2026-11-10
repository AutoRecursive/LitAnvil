import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {it,expect} from 'vitest';
import {SessionItem} from '../src/Chat';
it('renders tool calls as collapsed blocks with status and errors',()=>{const html=renderToStaticMarkup(<SessionItem item={{type:'mcpToolCall',server:'litanvil',tool:'control_reader',status:'failed',arguments:{page:2},error:{message:'Not loaded'}}}/>);expect(html).toContain('<details');expect(html).not.toContain(' open');expect(html).toContain('litanvil');expect(html).toContain('失败');expect(html).toContain('Not loaded')});
it('shows reasoning summaries only and omits hidden raw reasoning',()=>{const html=renderToStaticMarkup(<SessionItem item={{type:'reasoning',summary:['Public summary'],content:['private text']}}/>);expect(html).toContain('Public summary');expect(html).not.toContain('private text')});
it('renders markdown answers and keeps reference documents out of user bubbles',()=>{const html=renderToStaticMarkup(<SessionItem item={{type:'agentMessage',text:'**answer**'}}/>);expect(html).toContain('<strong>answer</strong>');const user=renderToStaticMarkup(<SessionItem item={{type:'userMessage',content:[{type:'text',text:'question'},{type:'text',text:'Reference document hidden body'}]}}/>);expect(user).toContain('question');expect(user).not.toContain('hidden body')});
