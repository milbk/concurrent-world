import {
    type MarkdownMessageSchema,
    type Message,
    type ReplyMessageSchema,
    type ProfileSchema,
    type User
} from '@concurrent-world/client'
import { Box, IconButton, ListItem, Paper, type SxProps, Tooltip } from '@mui/material'
import { UserProfileCard } from './UserProfileCard'
import { Link as routerLink, useNavigate } from 'react-router-dom'
import { CCAvatar } from './ui/CCAvatar'
import { type ProfileOverride } from '@concurrent-world/client/dist/types/model/core'

export interface ContentWithCCAvatarProps {
    message?: Message<MarkdownMessageSchema | ReplyMessageSchema>
    author?: User
    profileOverride?: ProfileOverride
    characterOverride?: ProfileSchema
    avatarOverride?: string
    children?: JSX.Element | Array<JSX.Element | undefined>
    sx?: SxProps
}

export const ContentWithCCAvatar = (props: ContentWithCCAvatarProps): JSX.Element => {
    const navigate = useNavigate()
    return (
        <>
            <Box itemProp="author" itemScope itemType="https://schema.org/Person">
                {props.author && (
                    <>
                        <meta itemProp="identifier" content={props.author.ccid} />
                        <meta itemProp="url" content={'https://concrnt.world/' + props.author.ccid} />
                    </>
                )}
                {props.author?.alias && <meta itemProp="alternateName" content={props.author.alias} />}
                {props.author?.profile?.username && (
                    <>
                        <meta itemProp="name" content={props.author.profile.username} />
                    </>
                )}
            </Box>
            <ListItem
                sx={{
                    wordBreak: 'break-word',
                    alignItems: 'flex-start',
                    flex: 1,
                    gap: 1
                }}
                disablePadding
            >
                <Tooltip
                    enterDelay={500}
                    enterNextDelay={500}
                    leaveDelay={300}
                    placement="top"
                    components={{
                        Tooltip: Paper
                    }}
                    componentsProps={{
                        tooltip: {
                            sx: {
                                m: 1,
                                border: '1px solid',
                                borderColor: 'divider',
                                minWidth: '300px'
                            }
                        }
                    }}
                    title={
                        <UserProfileCard
                            user={props.author}
                            subProfileID={props.profileOverride?.profileID}
                            profileOverride={props.characterOverride}
                        />
                    }
                >
                    <IconButton
                        sx={{
                            width: { xs: '38px', sm: '48px' },
                            height: { xs: '38px', sm: '48px' },
                            mt: { xs: '3px', sm: '5px' }
                        }}
                        component={routerLink}
                        to={
                            props.profileOverride?.link ??
                            '/' +
                                (props.author?.ccid ?? '') +
                                (props.profileOverride?.profileID ? '#' + props.profileOverride.profileID : '')
                        }
                        target={props.profileOverride?.link ? '_blank' : undefined}
                        rel={props.profileOverride?.link ? 'noopener noreferrer' : undefined}
                    >
                        <CCAvatar
                            avatarURL={props.author?.profile?.avatar}
                            avatarOverride={props.avatarOverride || props.profileOverride?.avatar}
                            identiconSource={props.author?.ccid ?? ''}
                            sx={{
                                width: { xs: '38px', sm: '48px' },
                                height: { xs: '38px', sm: '48px' }
                            }}
                        />
                    </IconButton>
                </Tooltip>
                <Box
                    sx={{
                        display: 'flex',
                        flex: 1,
                        flexDirection: 'column',
                        width: '100%',
                        overflow: 'hidden',
                        ...props.sx
                    }}
                >
                    <div
                        style={{ cursor: 'pointer' }}
                        onClick={(event: any) => {
                            console.log(event.target)
                            const selectedString = window.getSelection()?.toString()
                            if (selectedString !== '') return
                            const navigateTo =
                                props.message?.document.meta.apObjectRef ??
                                `/${props.message?.author}/${props.message?.id}`
                            const isInternal =
                                navigateTo.startsWith('/') || navigateTo.startsWith('https://concrnt.world')
                            if (isInternal) {
                                navigate(`/${props.message?.author}/${props.message?.id}`)
                            } else {
                                window.open(navigateTo, '_blank')
                            }
                        }}
                    >
                        {props.children}
                    </div>
                </Box>
            </ListItem>
        </>
    )
}
