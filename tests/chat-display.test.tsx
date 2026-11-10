import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {it,expect} from 'vitest';
import {SessionItem} from '../src/Chat';
it('renders provider-neutral tool calls as collapsed blocks with status and errors',()=>{const html=renderToStaticMarkup(<SessionItem item={{id:'tool',type:'tool',name:'litanvil · control_reader',status:'failed',input:{page:2},error:'Not loaded'}}/>);expect(html).toContain('<details');expect(html).not.toContain(' open');expect(html).toContain('litanvil');expect(html).toContain('失败');expect(html).toContain('Not loaded')});
it('renders only the public reasoning summary provided by middleware',()=>{const html=renderToStaticMarkup(<SessionItem item={{id:'summary',type:'reasoning',text:'Public summary',visibility:'summary'}}/>);expect(html).toContain('Public summary')});
it('renders markdown answers and user text using the shared protocol',()=>{const html=renderToStaticMarkup(<SessionItem item={{id:'answer',type:'message',role:'assistant',text:'**answer**'}}/>);expect(html).toContain('<strong>answer</strong>');const user=renderToStaticMarkup(<SessionItem item={{id:'user',type:'message',role:'user',text:'question'}}/>);expect(user).toContain('question')});
